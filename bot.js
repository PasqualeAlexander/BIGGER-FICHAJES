const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, WebhookClient } = require('discord.js');
const {
    ligaData,
    saveData,
    pendingSignings,
    loadPendingSignings,
    addPendingSigning,
    updatePendingSigning,
    removePendingSigning
} = require('./dataManager.js');

let config;
try {
    config = require('./config.json');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error("❌ Error: No se encontró el archivo 'config.json'.");
        console.error("Por favor, renombra 'config.template.json' a 'config.json' y rellena los campos necesarios.");
        process.exit(1); // Detiene la ejecución si no hay configuración
    } else {
        throw error;
    }
}

const logWebhook = config.LOG_WEBHOOK_URL ? new WebhookClient({ url: config.LOG_WEBHOOK_URL }) : null;
if (logWebhook) {
    console.log('📢 Webhook de logs configurado.');
}

console.log('🚀 Iniciando bot...');
console.log('🔑 Token configurado:', config.TOKEN ? config.TOKEN.substring(0, 20) + '...' : 'NO CONFIGURADO');
console.log('📢 Canal de fichajes:', config.SIGNINGS_CHANNEL_ID || 'NO CONFIGURADO');
console.log('📉 Canal de bajas:', config.DISMISSALS_CHANNEL_ID || 'NO CONFIGURADO');
console.log('👥 Roles admin:', config.ADMIN_ROLE_IDS ? config.ADMIN_ROLE_IDS.length : 0);
console.log('🔑 ID de Rol para Restablecer (Moderador):', config.RESET_ROLE_ID || 'NO CONFIGURADO');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});
console.log('⚙️ Cliente Discord creado');


// --- Funciones Principales del Bot ---

function extractTeamAndModality(interaction) {
    const channelName = interaction.channel.name || '';
    const parentName = interaction.channel.parent?.name || '';
    let equipo = 'Equipo no identificado';
    let modalidad = 'MODALIDAD';
    const equipoMatch = channelName.match(/^([^-]+)\s*-/);
    if (equipoMatch) {
        equipo = equipoMatch[1].trim();
    }
    const modalidadMatch = parentName.match(/equipos-(bigger[\w\d]+)/i);
    if (modalidadMatch) {
        modalidad = modalidadMatch[1].toUpperCase();
    }
    return { equipo, modalidad };
}

client.once('ready', async () => {
    console.log(`✅ Bot conectado exitosamente como ${client.user.tag}`);
    await loadPendingSignings();
    registerCommands();
});

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('fichar')
            .setDescription('Enviar solicitud de fichaje a un jugador')
            .addUserOption(option => option.setName('jugador').setDescription('El jugador a fichar').setRequired(true))
            .addStringOption(option => option.setName('tipo').setDescription('Tipo de fichaje: art o libre').setRequired(true))
            .addStringOption(option =>
                option.setName('rol').setDescription('Asignar rol (opcional)').setRequired(false)
                    .addChoices({ name: 'Capitán', value: 'C' }, { name: 'Subcapitán', value: 'SC' })
            ),
        new SlashCommandBuilder()
            .setName('bajar')
            .setDescription('Bajar a un jugador del equipo')
            .addUserOption(option => option.setName('jugador').setDescription('El jugador que fue bajado').setRequired(true))
            .addStringOption(option => option.setName('motivo').setDescription('Motivo de la baja (opcional)').setRequired(false)),
        new SlashCommandBuilder()
            .setName('establecer_plantilla')
            .setDescription('Crea el mensaje de plantilla en este canal para que el bot lo actualice'),
        new SlashCommandBuilder()
            .setName('cancelar')
            .setDescription('Darse de baja de tu equipo actual')
                        .addStringOption(option =>
                            option.setName('motivo')
                                .setDescription('Motivo de tu baja (opcional)')
                                .setRequired(false)
                        ),
                    new SlashCommandBuilder()
                        .setName('info')
                        .setDescription('Muestra la información de un jugador (equipo, modalidad, rol)')
                        .addUserOption(option => 
                            option.setName('jugador')
                                .setDescription('El jugador del que quieres ver la info')
                                .setRequired(true)
                        ),
                    new SlashCommandBuilder()
                        .setName('plantilla')
                        .setDescription('Muestra la plantilla de un equipo específico')
                        .addStringOption(option =>
                            option.setName('modalidad')
                                .setDescription('La modalidad del equipo')
                                .setRequired(true)
                                .setAutocomplete(true)
                        )
                                    .addStringOption(option =>
                                        option.setName('equipo')
                                            .setDescription('El nombre del equipo')
                                            .setRequired(true)
                                            .setAutocomplete(true)
                                    ),
                                new SlashCommandBuilder()
                                    .setName('rol')
                                    .setDescription('Modifica el rol de un jugador en una plantilla')
                                    .addUserOption(option =>
                                        option.setName('jugador')
                                            .setDescription('El jugador al que quieres cambiar el rol')
                                            .setRequired(true)
                                    )
                                                .addStringOption(option =>
                                                    option.setName('rol')
                                                        .setDescription('El nuevo rol que quieres asignar')
                                                        .setRequired(true)
                                                        .addChoices(
                                                            { name: 'Capitán', value: 'C' },
                                                            { name: 'Subcapitán', value: 'SC' },
                                                            { name: 'Jugador', value: 'null' }
                                                        )
                                                ),
                                            new SlashCommandBuilder()
                                                .setName('equipo')
                                                .setDescription('Gestiona los equipos de la liga')
                                                .addSubcommand(subcommand =>
                                                    subcommand
                                                        .setName('crear')
                                                        .setDescription('Crea un nuevo equipo en una modalidad')
                                                        .addStringOption(option =>
                                                            option.setName('nombre')
                                                                .setDescription('El nombre del nuevo equipo')
                                                                .setRequired(true)
                                                        )
                                                        .addStringOption(option =>
                                                            option.setName('modalidad')
                                                                .setDescription('La modalidad en la que se creará el equipo')
                                                                .setRequired(true)
                                                                .setAutocomplete(true)
                                                        )
                                                )
                                                .addSubcommand(subcommand =>
                                                    subcommand
                                                        .setName('eliminar')
                                                        .setDescription('Elimina un equipo existente de una modalidad')
                                                        .addStringOption(option =>
                                                            option.setName('nombre')
                                                                .setDescription('El nombre del equipo a eliminar')
                                                                .setRequired(true)
                                                                .setAutocomplete(true)
                                                        )
                                                        .addStringOption(option =>
                                                            option.setName('modalidad')
                                                                .setDescription('La modalidad de la que se eliminará el equipo')
                                                                .setRequired(true)
                                                                .setAutocomplete(true)
                                                        )
                                                ),
                                            new SlashCommandBuilder()
                                                .setName('restablecer_plantilla')
                                                .setDescription('Elimina TODOS los jugadores de una plantilla para iniciar una nueva temporada.')
                                                .addStringOption(option =>
                                                    option.setName('modalidad')
                                                        .setDescription('La modalidad del equipo a restablecer')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                )
                                                .addStringOption(option =>
                                                    option.setName('equipo')
                                                        .setDescription('El equipo a restablecer')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                ),
                                            new SlashCommandBuilder()
                                                .setName('sincronizar_plantilla')
                                                .setDescription('Sincroniza manualmente una plantilla existente con una lista de jugadores.')
                                                .addStringOption(option =>
                                                    option.setName('modalidad')
                                                        .setDescription('La modalidad del equipo a sincronizar')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                )
                                                .addStringOption(option =>
                                                    option.setName('equipo')
                                                        .setDescription('El equipo a sincronizar')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                )
                                                .addStringOption(option =>
                                                    option.setName('jugadores')
                                                        .setDescription('Lista de menciones (@jugador) de toda la plantilla')
                                                        .setRequired(true)
                                                )
                                                .addIntegerOption(option =>
                                                    option.setName('articulos')
                                                        .setDescription('Número de artículos usados (opcional)')
                                                        .setRequired(false)
                                                )
                                        ];    try {
        console.log('🆕 REGISTRANDO comandos SOLO en el servidor principal...');
        const mainGuild = client.guilds.cache.get('1210830619228119090'); // LNB
        if (mainGuild) {
            await mainGuild.commands.set(commands);
            console.log(`✅ Comandos registrados SOLO en ${mainGuild.name}`);
        } else {
            console.error('❌ No se encontró el servidor principal!');
        }
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        console.log(`⚙️ Procesando comando: /${interaction.commandName}`);
        try {
            if (interaction.commandName === 'fichar') {
                await handleFicharCommand(interaction);
            } else if (interaction.commandName === 'bajar') {
                await handleBajarCommand(interaction);
            } else if (interaction.commandName === 'establecer_plantilla') {
                await handleEstablecerPlantillaCommand(interaction);
            } else if (interaction.commandName === 'cancelar') {
                await handleCancelarCommand(interaction);
            } else if (interaction.commandName === 'info') {
                await handleInfoCommand(interaction);
            } else if (interaction.commandName === 'plantilla') {
                await handlePlantillaCommand(interaction);
            } else if (interaction.commandName === 'rol') {
                await handleRolCommand(interaction);
            } else if (interaction.commandName === 'equipo') {
                await handleEquipoCommand(interaction);
            } else if (interaction.commandName === 'restablecer_plantilla') {
                await handleRestablecerPlantillaCommand(interaction);
            } else if (interaction.commandName === 'sincronizar_plantilla') {
                await handleSincronizarPlantillaCommand(interaction);
            }
        } catch (error) {
            console.error('❌ Error procesando interacción de comando:', error);
        }
    } else if (interaction.isButton()) {
        try {
            const customId = interaction.customId;

            if (customId.startsWith('public_accept_') || customId.startsWith('public_reject_')) {
                const accepted = customId.startsWith('public_accept_');
                const signingId = customId.replace(/public_accept_|public_reject_/g, '');
                await handlePublicSigningResponse(interaction, accepted, signingId);

            } else if (customId.startsWith('admin_confirm_signing_')) {
                await handleAdminConfirmation(interaction);

            } else if (customId.startsWith('confirm_reset_')) {
                if (!interaction.member.roles.cache.has(config.RESET_ROLE_ID)) {
                    return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden confirmar esta acción.', ephemeral: true });
                }
                
                const [, , modalityKey, equipo] = customId.split('_');
                const teamData = ligaData[modalityKey]?.teams[equipo];

                if (teamData) {
                    teamData.jugadores_habilitados = [];
                    teamData.articulos_usados = 0;
                    await saveData();
                    await updateTeamMessage(interaction.guild, modalityKey, equipo);

                    await interaction.update({
                        content: `✅ Plantilla de **${equipo}** restablecida con éxito.`,
                        components: []
                    });
                } else {
                    await interaction.update({
                        content: '❌ Error: No se pudo encontrar el equipo para restablecer.',
                        components: []
                    });
                }

            } else if (customId.startsWith('cancel_reset_')) {
                if (!interaction.member.roles.cache.has(config.RESET_ROLE_ID)) {
                    return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden cancelar esta acción.', ephemeral: true });
                }
                await interaction.update({
                    content: 'Operación cancelada.',
                    components: []
                });
            } else if (customId.startsWith('confirm_delete_')) {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
                    return await interaction.reply({ content: '❌ No tienes permisos para confirmar esta acción.', ephemeral: true });
                }

                const [, , modalityKey, equipo] = customId.split('_');
                if (ligaData[modalityKey]?.teams[equipo]) {
                    delete ligaData[modalityKey].teams[equipo];
                    await saveData();
                    await interaction.update({
                        content: `✅ El equipo **${equipo}** ha sido eliminado de la modalidad **${modalityKey.toUpperCase()}**.`,
                        components: []
                    });
                } else {
                    await interaction.update({
                        content: '❌ Error: No se pudo encontrar el equipo para eliminar.',
                        components: []
                    });
                }
            } else if (customId.startsWith('cancel_delete_')) {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
                    return await interaction.reply({ content: '❌ No tienes permisos para cancelar esta acción.', ephemeral: true });
                }
                await interaction.update({
                    content: 'Operación cancelada.',
                    components: []
                });
            }
        } catch (error) {
            console.error('❌ Error procesando interacción de botón:', error);
        }
    } else if (interaction.isAutocomplete()) {
        try {
            const focusedOption = interaction.options.getFocused(true);
            let choices = [];

            if (focusedOption.name === 'modalidad') {
                choices = Object.keys(ligaData);
            }

            if (focusedOption.name === 'equipo') {
                const modality = interaction.options.getString('modalidad');
                if (modality && ligaData[modality.toLowerCase()]) {
                    choices = Object.keys(ligaData[modality.toLowerCase()].teams);
                }
            }

            if (interaction.commandName === 'equipo' && focusedOption.name === 'nombre') {
                const modality = interaction.options.getString('modalidad');
                if (modality && ligaData[modality.toLowerCase()]) {
                    choices = Object.keys(ligaData[modality.toLowerCase()].teams);
                }
            }

            const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedOption.value.toLowerCase()));
            await interaction.respond(
                filtered.map(choice => ({ name: choice, value: choice })).slice(0, 25)
            );
        } catch (error) {
            console.error('❌ Error en autocompletado:', error);
        }
    }
});

async function handleFicharCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const requester = interaction.user;
    const tipo = interaction.options.getString('tipo').trim().toLowerCase();
    const rol = interaction.options.getString('rol') || null;

    if (!['art', 'libre'].includes(tipo)) {
        return await interaction.reply({ content: '❌ El "tipo" debe ser "art" o "libre".', ephemeral: true });
    }
    if (targetUser.id === requester.id && rol !== 'C' && rol !== 'SC') {
        return await interaction.reply({ content: '❌ Solo puedes ficharte a ti mismo para asignarte el rol de Capitán o Subcapitán.', ephemeral: true });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para fichar.', ephemeral: true });
    }

    const equipoInfo = extractTeamAndModality(interaction);
    const tipoEmoji = tipo === 'art' ? '<:ART:1380746252513317015>' : '✍️';
    const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;

    const signingData = {
        targetUserId: targetUser.id,
        requesterId: requester.id,
        guildId: interaction.guild.id,
        timestamp: Date.now(),
        equipo: equipoInfo.equipo,
        modalidad: equipoInfo.modalidad,
        tipo,
        tipoEmoji,
        rol
    };

    const publicRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`public_accept_${signingId}`).setLabel('Acepto').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`public_reject_${signingId}`).setLabel('Rechazo').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );

    const mensajePublico = `${tipoEmoji} 📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo}.\nEsperando respuesta...`;
    const publicMessage = await interaction.reply({ content: mensajePublico, components: [publicRow], fetchReply: true });

    signingData.publicMessageId = publicMessage.id;
    signingData.channelId = interaction.channel.id;
    await addPendingSigning(signingId, signingData);
}

async function handleBajarCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const motivo = interaction.options.getString('motivo');
    const requester = interaction.user;
    const equipoInfoBaja = extractTeamAndModality(interaction);

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para bajar jugadores.', ephemeral: true });
    }

    const modalityKey = equipoInfoBaja.modalidad.toLowerCase();
    const teamName = equipoInfoBaja.equipo;
    const teamData = ligaData[modalityKey]?.teams[teamName];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}".`, ephemeral: true });
    }

    const playerIndex = teamData.jugadores_habilitados.findIndex(p => p.id === targetUser.id);
    if (playerIndex === -1) {
        return await interaction.reply({ content: `❌ ${targetUser.username} no está en ${teamName}.`, ephemeral: true });
    }

    teamData.jugadores_habilitados.splice(playerIndex, 1);
    saveData();

    await notifyPlayerDismissal(interaction.guild, targetUser, requester, motivo, equipoInfoBaja);
    await updateTeamMessage(interaction.guild, modalityKey, teamName);

    const logMessage = `📉 **BAJA:** ${targetUser.username} ha sido bajado de **${teamName}** por ${requester.username}. Motivo: ${motivo || 'No especificado'}`;
    await logMovement(logMessage);

    await interaction.reply({ content: `✅ ${targetUser.username} ha sido bajado de ${teamName}.`, ephemeral: true });
}

async function handleCancelarCommand(interaction) {
    const player = interaction.user;
    const motivo = interaction.options.getString('motivo');
    let playerTeamInfo = null;

    for (const modalityKey in ligaData) {
        for (const teamName in ligaData[modalityKey].teams) {
            const team = ligaData[modalityKey].teams[teamName];
            if (team.jugadores_habilitados.some(p => p.id === player.id)) {
                playerTeamInfo = { modalityKey, teamName, team };
                break;
            }
        }
        if (playerTeamInfo) break;
    }

    if (!playerTeamInfo) {
        return await interaction.reply({ content: '❌ No estás en ningún equipo.', ephemeral: true });
    }

    const { modalityKey, teamName, team } = playerTeamInfo;
    team.jugadores_habilitados = team.jugadores_habilitados.filter(p => p.id !== player.id);
    saveData();

    await updateTeamMessage(interaction.guild, modalityKey, teamName);
    const equipoInfo = { equipo: teamName, modalidad: modalityKey.toUpperCase() };
    await notifyPlayerDismissal(interaction.guild, player, player, motivo || 'Baja voluntaria', equipoInfo);
    
    const logMessage = `↩️ **BAJA VOLUNTARIA:** ${player.username} ha dejado **${teamName}**. Motivo: ${motivo || 'No especificado'}`;
    await logMovement(logMessage);

    await interaction.reply({ content: `✅ Te has dado de baja de **${teamName}**.`, ephemeral: true });
}

async function handleInfoCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    let playerInfo = null;

    for (const modalityKey in ligaData) {
        for (const teamName in ligaData[modalityKey].teams) {
            const team = ligaData[modalityKey].teams[teamName];
            const playerFound = team.jugadores_habilitados.find(p => p.id === targetUser.id);
            if (playerFound) {
                playerInfo = {
                    teamName,
                    modality: modalityKey.toUpperCase(),
                    role: playerFound.rol ? (playerFound.rol === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador'
                };
                break;
            }
        }
        if (playerInfo) break;
    }

    if (!playerInfo) {
        return await interaction.reply({ content: `❌ ${targetUser.username} no está registrado en ningún equipo.`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`Información de ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: '🛡️ Equipo', value: playerInfo.teamName, inline: true },
            { name: '🎮 Modalidad', value: playerInfo.modality, inline: true },
            { name: '✨ Rol', value: playerInfo.role, inline: true }
        );

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handlePlantillaCommand(interaction) {
    const modality = interaction.options.getString('modalidad');
    const teamName = interaction.options.getString('equipo');
    const modalityKey = modality.toLowerCase();

    const teamData = ligaData[modalityKey]?.teams[teamName];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${teamName}** en la modalidad **${modality}**.`, ephemeral: true });
    }

    const embed = await buildTeamEmbed(modalityKey, teamName);
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRolCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para usar este comando.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('jugador');
    const newRoleValue = interaction.options.getString('rol');
    const newRole = newRoleValue === 'null' ? null : newRoleValue;

    let playerInfo = null;
    let playerToUpdate = null;

    // Buscar al jugador
    for (const modalityKey in ligaData) {
        for (const teamName in ligaData[modalityKey].teams) {
            const team = ligaData[modalityKey].teams[teamName];
            const playerFound = team.jugadores_habilitados.find(p => p.id === targetUser.id);
            if (playerFound) {
                playerInfo = { modalityKey, teamName };
                playerToUpdate = playerFound;
                break;
            }
        }
        if (playerInfo) break;
    }

    if (!playerInfo) {
        return await interaction.reply({ content: `❌ ${targetUser.username} no está registrado en ningún equipo.`, ephemeral: true });
    }

    const oldRole = playerToUpdate.rol;
    playerToUpdate.rol = newRole;
    saveData();

    const { modalityKey, teamName } = playerInfo;
    await updateTeamMessage(interaction.guild, modalityKey, teamName);

    const oldRoleText = oldRole ? (oldRole === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador';
    const newRoleText = newRole ? (newRole === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador';

    const logMessage = `🔄 **CAMBIO DE ROL:** El rol de ${targetUser.username} en **${teamName}** fue cambiado de **${oldRoleText}** a **${newRoleText}** por ${interaction.user.username}.`;
    await logMovement(logMessage);

    await interaction.reply({ content: `✅ El rol de ${targetUser.username} en **${teamName}** ha sido actualizado a **${newRoleText}**.`, ephemeral: true });
}

async function handleEquipoCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para gestionar equipos.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    const nombre = interaction.options.getString('nombre');
    const modalidad = interaction.options.getString('modalidad');
    const modalityKey = modalidad.toLowerCase();

    if (subcommand === 'crear') {
        if (!ligaData[modalityKey]) {
            return await interaction.reply({ content: `❌ La modalidad **${modalidad}** no existe.`, ephemeral: true });
        }
        if (ligaData[modalityKey].teams[nombre]) {
            return await interaction.reply({ content: `❌ El equipo **${nombre}** ya existe en la modalidad **${modalidad}**.`, ephemeral: true });
        }

        ligaData[modalityKey].teams[nombre] = {
            jugadores_habilitados: [],
            articulos_usados: 0,
            channel_id: null,
            message_id: null
        };
        await saveData();
        return await interaction.reply({ content: `✅ Equipo **${nombre}** creado con éxito en la modalidad **${modalidad}**.`, ephemeral: true });

    } else if (subcommand === 'eliminar') {
        if (!ligaData[modalityKey] || !ligaData[modalityKey].teams[nombre]) {
            return await interaction.reply({ content: `❌ El equipo **${nombre}** no se encontró en la modalidad **${modalidad}**.`, ephemeral: true });
        }

        const confirmationId = `delete_${modalityKey}_${nombre}`;
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_${confirmationId}`)
                    .setLabel('Confirmar Eliminación')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_${confirmationId}`)
                    .setLabel('Cancelar')
                    .setStyle(ButtonStyle.Secondary)
            );

        return await interaction.reply({
            content: `**¿Estás seguro de que quieres eliminar el equipo ${nombre} de la modalidad ${modalidad}?**\nEsta acción no se puede deshacer.`,
            components: [row],
            ephemeral: true
        });
    }
}

async function handleRestablecerPlantillaCommand(interaction) {
    if (!interaction.member.roles.cache.has(config.RESET_ROLE_ID)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modalidad = interaction.options.getString('modalidad');
    const equipo = interaction.options.getString('equipo');

    const modalityKey = modalidad.toLowerCase();
    const teamData = ligaData[modalityKey]?.teams[equipo];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${equipo}** en la modalidad **${modalidad}**.`, ephemeral: true });
    }

    const confirmationId = `reset_${modalityKey}_${equipo}`;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_${confirmationId}`)
                .setLabel('Confirmar Restablecimiento')
                .setEmoji('⚠️')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`cancel_${confirmationId}`)
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.reply({
        content: `**¿Estás seguro de que quieres restablecer la plantilla de ${equipo}?**\nEsta acción eliminará a **TODOS** los jugadores y reiniciará los artículos. No se puede deshacer.`,
        components: [row],
        ephemeral: true
    });
}

async function handleSincronizarPlantillaCommand(interaction) {
    if (!interaction.member.roles.cache.has(config.RESET_ROLE_ID)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modalidad = interaction.options.getString('modalidad');
    const equipo = interaction.options.getString('equipo');
    const jugadoresString = interaction.options.getString('jugadores');
    const articulos = interaction.options.getInteger('articulos');

    const modalityKey = modalidad.toLowerCase();
    const teamData = ligaData[modalityKey]?.teams[equipo];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${equipo}** en la modalidad **${modalidad}**.`, ephemeral: true });
    }

    // Extraer IDs de las menciones
    const mentionRegex = /<@!?(\d+)>/g;
    const matches = jugadoresString.matchAll(mentionRegex);
    const playerIds = [...matches].map(match => match[1]);

    if (playerIds.length === 0) {
        return await interaction.reply({ content: '❌ No se encontraron menciones de jugadores válidas en el texto proporcionado.', ephemeral: true });
    }

    try {
        await interaction.deferReply({ ephemeral: true });

        const newPlayerList = [];
        for (const id of playerIds) {
            try {
                const user = await client.users.fetch(id);
                newPlayerList.push({ id: user.id, name: user.username, rol: null });
            } catch (error) {
                console.warn(`No se pudo encontrar al usuario con ID ${id}. Saltando...`);
            }
        }

        // Actualizar datos
        teamData.jugadores_habilitados = newPlayerList;
        if (articulos !== null && articulos >= 0) {
            teamData.articulos_usados = articulos;
        }

        await saveData();
        await updateTeamMessage(interaction.guild, modalityKey, equipo);

        await interaction.editReply({ content: `✅ Plantilla de **${equipo}** sincronizada con éxito con ${newPlayerList.length} jugadores.` });

    } catch (error) {
        console.error('❌ Error sincronizando la plantilla:', error);
        await interaction.editReply({ content: 'Ocurrió un error al procesar tu solicitud.' });
    }
}

async function handlePublicSigningResponse(interaction, accepted, signingId) {
    const signingData = pendingSignings.get(signingId);
    if (!signingData || interaction.user.id !== signingData.targetUserId) {
        return await interaction.reply({ content: '❌ No puedes responder a esta solicitud.', ephemeral: true });
    }

    const requester = await client.users.fetch(signingData.requesterId);
    const targetUser = interaction.user;
    const { tipoEmoji, equipo, modalidad } = signingData;

    const updatedContent = `${tipoEmoji} 📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipo}.\n\n${accepted ? '✅' : '❌'} **${targetUser.username} ${accepted ? 'ACEPTA' : 'RECHAZA'} el fichaje**`;
    await interaction.update({ content: updatedContent, components: [] });

    await notifyAdmins(interaction.guild, targetUser, requester, accepted, signingId);
    if (!accepted) {
        await removePendingSigning(signingId);
    }
}

async function notifyAdmins(guild, targetUser, requester, accepted, signingId) {
    const signingsChannelId = config.SIGNINGS_CHANNEL_ID;
    if (!signingsChannelId) return;

    const signingsChannel = await guild.channels.fetch(signingsChannelId);
    const signingInfo = pendingSignings.get(signingId);
    if (!signingsChannel || !signingInfo) return;

    const { equipo, modalidad, tipoEmoji } = signingInfo;
    const embed = new EmbedBuilder()
        .setColor(accepted ? '#00ff00' : '#ff0000')
        .setTitle(`${tipoEmoji} 📋 Respuesta de Fichaje`)
        .addFields(
            { name: '👤 Jugador', value: `${targetUser}`, inline: true },
            { name: '🎯 Solicitado por', value: `${requester}`, inline: true },
            { name: '📊 Respuesta', value: accepted ? '✅ **ACEPTA**' : '❌ **RECHAZA**', inline: true },
            { name: '🛡️ Equipo', value: equipo, inline: true },
            { name: '🎮 Modalidad', value: modalidad, inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL());

    if (accepted) {
        embed.setFooter({ text: 'Reacciona para confirmar el fichaje en la planilla' });
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`admin_confirm_signing_${signingId}`).setLabel('Confirmar en planilla').setEmoji('✅').setStyle(ButtonStyle.Success)
        );
        await signingsChannel.send({ embeds: [embed], components: [confirmRow] });
    } else {
        embed.setFooter({ text: 'Fichaje rechazado' });
        await signingsChannel.send({ embeds: [embed] });
    }
}

async function notifyPlayerDismissal(guild, targetUser, requester, motivo, equipoInfo) {
    const dismissalsChannelId = config.DISMISSALS_CHANNEL_ID;
    if (!dismissalsChannelId) return;

    const dismissalsChannel = await guild.channels.fetch(dismissalsChannelId);
    if (!dismissalsChannel) return;

    const embed = new EmbedBuilder()
        .setColor('#ff4444')
        .setTitle('📉 Baja de Jugador')
        .addFields(
            { name: '👤 Jugador', value: `${targetUser}`, inline: true },
            { name: '🛡️ Bajado por', value: `${requester}`, inline: true },
            { name: '🛡️ Equipo', value: equipoInfo.equipo, inline: true },
            { name: '🎮 Modalidad', value: equipoInfo.modalidad, inline: true },
            { name: '📅 Fecha', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
        );
    if (motivo) {
        embed.addFields({ name: '📝 Motivo', value: motivo, inline: false });
    }
    await dismissalsChannel.send({ embeds: [embed] });
}

async function logMovement(logMessage) {
    if (!logWebhook) return; // No hacer nada si no está configurado
    try {
        await logWebhook.send(logMessage);
    } catch (error) {
        console.error(`❌ Error al enviar al webhook de logs:`, error);
    }
}

async function handleAdminConfirmation(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });
    }

    const signingId = interaction.customId.replace('admin_confirm_signing_', '');
    const signingData = pendingSignings.get(signingId);
    if (!signingData) {
        return await interaction.reply({ content: '❌ No se encontró la solicitud de fichaje.', ephemeral: true });
    }

    const targetUser = await client.users.fetch(signingData.targetUserId);
    const modalityKey = signingData.modalidad.toLowerCase();
    const teamName = signingData.equipo;
    const leagueData = ligaData[modalityKey];
    const teamData = leagueData?.teams[teamName];

    if (!teamData) {
        return await interaction.reply({ content: `❌ Error: No se encontró el equipo "${teamName}".`, ephemeral: true });
    }
    if (teamData.jugadores_habilitados.length >= leagueData.max_players) {
        return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${teamName} ya tiene ${leagueData.max_players} jugadores.`, ephemeral: true });
    }
    if (signingData.tipo === 'art' && teamData.articulos_usados >= config.ARTICLES_LIMIT) {
        return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${teamName} ya usó sus ${config.ARTICLES_LIMIT} artículos.`, ephemeral: true });
    }

    if (signingData.tipo === 'art') {
        teamData.articulos_usados++;
    }
    teamData.jugadores_habilitados.push({ id: targetUser.id, name: targetUser.username, rol: signingData.rol });
    saveData();

    await updateTeamMessage(interaction.guild, modalityKey, teamName);
    await removePendingSigning(signingId);

    const logMessage = `✅ **FICHAJE:** ${targetUser.username} se une a **${teamName}**. (Tipo: ${signingData.tipo}, Rol: ${signingData.rol || 'Jugador'}). Confirmado por ${interaction.user.username}.`;
    await logMovement(logMessage);

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor('#FFD700')
        .addFields({ name: '✅ Confirmado por', value: `${interaction.user} - <t:${Math.floor(Date.now() / 1000)}:F>`, inline: false })
        .setFooter({ text: 'Fichaje confirmado en la planilla' });

    await interaction.update({ embeds: [updatedEmbed], components: [] });
}

async function handleEstablecerPlantillaCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });
    }

    const { equipo, modalidad } = extractTeamAndModality(interaction);
    const modalityKey = modalidad.toLowerCase();
    const teamName = equipo;
    const teamData = ligaData[modalityKey]?.teams[teamName];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}".`, ephemeral: true });
    }

    const embed = await buildTeamEmbed(modalityKey, teamName);
    const message = await interaction.channel.send({ embeds: [embed] });

    teamData.channel_id = message.channel.id;
    teamData.message_id = message.id;
    saveData();

    await interaction.reply({ content: `✅ Mensaje de plantilla establecido para ${teamName}.`, ephemeral: true });
}

async function buildTeamEmbed(modalityKey, teamName) {
    const leagueData = ligaData[modalityKey];
    const teamData = leagueData.teams[teamName];
    const playerList = teamData.jugadores_habilitados.map((player, index) => {
        let roleTag = player.rol ? (player.rol === 'C' ? ' (C)' : ' SC') : '';
        return `${index + 1}. <@${player.id}>${roleTag}`;
    }).join('\n') || '*Sin jugadores fichados*';

    const description = `# HABILITADOS\n\n${playerList}\n\n` +
                        `**${teamData.jugadores_habilitados.length}/${leagueData.max_players} - ${teamData.articulos_usados}/4 <:ART:1380746252513317015>**\n` +
                        `-# Desvirtuar = aislamiento`;

    return new EmbedBuilder()
        .setColor('#2c806a')
        .setTitle(`HABILITADOS DE ${teamName.toUpperCase()}`)
        .setDescription(description)
        .setTimestamp();
}

async function updateTeamMessage(guild, modalityKey, teamName) {
    const teamData = ligaData[modalityKey]?.teams[teamName];
    if (!teamData || !teamData.channel_id || !teamData.message_id) {
        console.log(`Plantilla no establecida para ${teamName}. Usa /establecer_plantilla.`);
        return;
    }
    try {
        const channel = await guild.channels.fetch(teamData.channel_id);
        const message = await channel.messages.fetch(teamData.message_id);
        const embed = await buildTeamEmbed(modalityKey, teamName);
        await message.edit({ embeds: [embed] });
        console.log(`✅ Plantilla de ${teamName} actualizada.`);
    } catch (error) {
        console.error(`❌ Error al actualizar plantilla de ${teamName}:`, error);
    }
}

client.login(config.TOKEN);