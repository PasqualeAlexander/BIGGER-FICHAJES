const fs = require('fs');
let marketState = require('./market_state.json');

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

// Initialize marketState for any new modalities in ligaData
let marketStateUpdated = false;
if (!marketState.modalities) {
    marketState.modalities = {};
    marketStateUpdated = true;
}

for (const modalityKey in ligaData) {
    if (!marketState.modalities[modalityKey]) {
        marketState.modalities[modalityKey] = {
            season_state: 'PRETEMPORADA',
            mid_season_free_signings_used: 0,
            season_start_date: new Date().toISOString().split('T')[0]
        };
        marketStateUpdated = true;
    }
}

if (marketStateUpdated) {
    fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2));
    console.log('✅ market_state.json actualizado con nuevas modalidades.');
}

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

function isModerator(member) {
    return member.roles.cache.has(config.RESET_ROLE_ID);
}

function isAdmin(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator) || config.ADMIN_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

function isAuthorized(interaction) {
    return isAdmin(interaction.member) || isModerator(interaction.member);
}

function isCaptain(interaction) {
    const { equipo, modalidad } = extractTeamAndModality(interaction);
    const modalityKey = modalidad.toLowerCase();
    const teamName = equipo;

    if (!ligaData[modalityKey] || !ligaData[modalityKey].teams[teamName]) {
        return false;
    }

    const teamData = ligaData[modalityKey].teams[teamName];
    const player = teamData.jugadores_habilitados.find(p => p.id === interaction.user.id);

    return player && player.rol === 'C';
}

function isCaptainOrAuthorized(interaction) {
    return isCaptain(interaction) || isAuthorized(interaction);
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
                    .addStringOption(option =>
                        option.setName('rol').setDescription('Asignar rol (opcional)').setRequired(false)
                            .addChoices({ name: 'Capitán', value: 'C' }, { name: 'Subcapitán', value: 'SC' })),
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
                                                ),
                                            new SlashCommandBuilder()
                                                .setName('otorgar_articulos')
                                                .setDescription('Otorga artículos adicionales a un equipo.')
                                                .addStringOption(option =>
                                                    option.setName('modalidad')
                                                        .setDescription('La modalidad del equipo')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                )
                                                .addStringOption(option =>
                                                    option.setName('equipo')
                                                        .setDescription('El equipo al que otorgar artículos')
                                                        .setRequired(true)
                                                        .setAutocomplete(true)
                                                )
                                                .addIntegerOption(option =>
                                                    option.setName('cantidad')
                                                        .setDescription('La cantidad de artículos a otorgar (número positivo)')
                                                        .setRequired(true)
                                                        .setMinValue(1)
                                                ),
        new SlashCommandBuilder()
            .setName('mercado')
            .setDescription('Gestiona el estado del mercado de fichajes (abrir/cerrar en temporada regular)')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('abrir')
                    .setDescription('Abre el mercado de fichajes libres (5 fichajes) durante la temporada regular')
                    .addStringOption(option =>
                        option.setName('modalidad')
                            .setDescription('La modalidad para la que se gestiona el mercado')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('cerrar')
                    .setDescription('Cierra el mercado de fichajes libres durante la temporada regular')
                    .addStringOption(option =>
                        option.setName('modalidad')
                            .setDescription('La modalidad para la que se gestiona el mercado')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
            ),
        new SlashCommandBuilder()
            .setName('iniciar_temporada')
            .setDescription('Inicia una nueva temporada, cerrando el mercado libre y reiniciando contadores.')
            .addStringOption(option =>
                option.setName('modalidad')
                    .setDescription('La modalidad para la que se inicia la temporada')
                    .setRequired(true)
                    .setAutocomplete(true)
            ),
                                                    new SlashCommandBuilder()
                                                        .setName('finalizar_temporada')
                                                        .setDescription('Finaliza la temporada actual, abriendo el mercado libre ilimitado (pretemporada).')
                                                        .addStringOption(option =>
                                                            option.setName('modalidad')
                                                                .setDescription('La modalidad para la que se finaliza la temporada')
                                                                .setRequired(true)
                                                                .setAutocomplete(true)
                                                        ),
                        new SlashCommandBuilder()
                            .setName('help')
                            .setDescription('Muestra la lista de comandos disponibles'),
                        new SlashCommandBuilder()
                            .setName('helpcapitan')
                            .setDescription('Muestra la lista de comandos disponibles para capitanes'),
                        new SlashCommandBuilder()
                            .setName('actualizar_todas_planillas')
                            .setDescription('Migra todas las plantillas existentes al nuevo formato de texto plano.'),
                                                        ];    try {        console.log('🆕 REGISTRANDO comandos SOLO en el servidor principal...');
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
            } else if (interaction.commandName === 'otorgar_articulos') {
                await handleOtorgarArticulosCommand(interaction);
            } else if (interaction.commandName === 'mercado') {
                await handleMercadoCommand(interaction);
            } else if (interaction.commandName === 'iniciar_temporada') {
                await handleIniciarTemporadaCommand(interaction);
            } else if (interaction.commandName === 'finalizar_temporada') {
                await handleFinalizarTemporadaCommand(interaction);
            } else if (interaction.commandName === 'help') {
                await handleHelpCommand(interaction);
            } else if (interaction.commandName === 'helpcapitan') {
                await handleHelpCapitanCommand(interaction);
            } else if (interaction.commandName === 'actualizar_todas_planillas') {
                await handleActualizarTodasPlanillasCommand(interaction);
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
                if (!isAuthorized(interaction)) {
                    return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden confirmar esta acción.', ephemeral: true });
                }
                
                const [, , modalityKey, equipo] = customId.split('_');
                const teamData = ligaData[modalityKey]?.teams[equipo];

                if (teamData) {
                    teamData.jugadores_habilitados = [];
                    teamData.articulos_usados = 0;
                    teamData.fichajes_libres_usados = 0;
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
                if (!isAuthorized(interaction)) {
                    return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden cancelar esta acción.', ephemeral: true });
                }
                await interaction.update({
                    content: 'Operación cancelada.',
                    components: []
                });
            } else if (customId.startsWith('confirm_delete_')) {
                if (!isAuthorized(interaction)) {
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
                if (!isAuthorized(interaction)) {
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
    const rol = interaction.options.getString('rol') || null;

    if (targetUser.id === requester.id && rol !== 'C' && rol !== 'SC') {
        return await interaction.reply({ content: '❌ Solo puedes ficharte a ti mismo para asignarte el rol de Capitán o Subcapitán.', ephemeral: true });
    }
    if (!isCaptainOrAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ No tienes permisos para fichar.', ephemeral: true });
    }

    const equipoInfo = extractTeamAndModality(interaction);
    // tipo and tipoEmoji will be determined in handleAdminConfirmation based on market state
    const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;

    const signingData = {
        targetUserId: targetUser.id,
        requesterId: requester.id,
        guildId: interaction.guild.id,
        timestamp: Date.now(),
        equipo: equipoInfo.equipo,
        modalidad: equipoInfo.modalidad,
        rol
    };

    const publicRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`public_accept_${signingId}`).setLabel('Acepto').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`public_reject_${signingId}`).setLabel('Rechazo').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );

    // The message will be generic, tipoEmoji will be added in handleAdminConfirmation
    const mensajePublico = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo}.\nEsperando respuesta...`;
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

    if (!isCaptainOrAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ No tienes permisos para bajar jugadores.', ephemeral: true });
    }

    const modalityKey = equipoInfoBaja.modalidad.toLowerCase();
    const teamName = equipoInfoBaja.equipo;

    const teams = ligaData[modalityKey]?.teams;
    const foundTeamName = teams ? Object.keys(teams).find(name => name.toLowerCase() === teamName.toLowerCase()) : undefined;
    const teamData = foundTeamName ? teams[foundTeamName] : undefined;

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}".`, ephemeral: true });
    }

    const playerIndex = teamData.jugadores_habilitados.findIndex(p => p.id === targetUser.id);
    if (playerIndex === -1) {
        return await interaction.reply({ content: `❌ ${targetUser.username} no está en ${foundTeamName}.`, ephemeral: true });
    }

    teamData.jugadores_habilitados.splice(playerIndex, 1);
    saveData();

    const updatedEquipoInfo = { equipo: foundTeamName, modalidad: equipoInfoBaja.modalidad };
    await notifyPlayerDismissal(interaction.guild, targetUser, requester, motivo, updatedEquipoInfo);
    await updateTeamMessage(interaction.guild, modalityKey, foundTeamName);

    const logMessage = `📉 **BAJA:** ${targetUser.username} ha sido bajado de **${foundTeamName}** por ${requester.username}. Motivo: ${motivo || 'No especificado'}`;
    await logMovement(logMessage);

    await interaction.reply({ content: `✅ ${targetUser.username} ha sido bajado de ${foundTeamName}.`, ephemeral: true });
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

    const teams = ligaData[modalityKey]?.teams;
    const foundTeamName = teams ? Object.keys(teams).find(name => name.toLowerCase() === teamName.toLowerCase()) : undefined;
    const teamData = foundTeamName ? teams[foundTeamName] : undefined;

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${teamName}** en la modalidad **${modality}**.`, ephemeral: true });
    }

    const embed = await buildTeamEmbed(interaction.guild, modalityKey, foundTeamName);
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRolCommand(interaction) {
    if (!isCaptainOrAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ No tienes permisos para usar este comando.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('jugador');
    const newRoleValue = interaction.options.getString('rol');
    const newRole = newRoleValue === 'null' ? null : newRoleValue;

    // Obtener el contexto del canal actual
    const { equipo, modalidad } = extractTeamAndModality(interaction);
    const modalityKey = modalidad.toLowerCase();
    const teamNameFromChannel = equipo;

    // Buscar el equipo de forma insensible a mayúsculas y minúsculas dentro de la modalidad actual
    const teams = ligaData[modalityKey]?.teams;
    const foundTeamName = teams ? Object.keys(teams).find(name => name.toLowerCase() === teamNameFromChannel.toLowerCase()) : undefined;
    const teamData = foundTeamName ? teams[foundTeamName] : undefined;

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se pudo determinar el equipo desde este canal, o el equipo \"${teamNameFromChannel}\" no existe en la modalidad ${modalidad}.`, ephemeral: true });
    }

    // Buscar al jugador dentro de ese equipo específico
    const playerToUpdate = teamData.jugadores_habilitados.find(p => p.id === targetUser.id);

    if (!playerToUpdate) {
        return await interaction.reply({ content: `❌ ${targetUser.username} no está en el equipo **${foundTeamName}**.`, ephemeral: true });
    }

    // Aplicar el cambio de rol
    const oldRole = playerToUpdate.rol;
    playerToUpdate.rol = newRole;
    await saveData();

    // Actualizar mensaje y registrar el cambio
    await updateTeamMessage(interaction.guild, modalityKey, foundTeamName);

    const oldRoleText = oldRole ? (oldRole === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador';
    const newRoleText = newRole ? (newRole === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador';

    const logMessage = `🔄 **CAMBIO DE ROL:** El rol de ${targetUser.username} en **${foundTeamName}** fue cambiado de **${oldRoleText}** a **${newRoleText}** por ${interaction.user.username}.`;
    await logMovement(logMessage);

    await interaction.reply({ content: `✅ El rol de ${targetUser.username} en **${foundTeamName}** ha sido actualizado a **${newRoleText}**.`, ephemeral: true });
}

async function handleEquipoCommand(interaction) {
    if (!isAuthorized(interaction)) {
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
            fichajes_libres_usados: 0,
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
    if (!isAuthorized(interaction)) {
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
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modalidad = interaction.options.getString('modalidad');
    const equipo = interaction.options.getString('equipo');
    const jugadoresRaw = interaction.options.getString('jugadores');
    const articulos = interaction.options.getInteger('articulos') || 0; // Default to 0 if not provided

    const modalityKey = modalidad.toLowerCase();
    const teamData = ligaData[modalityKey]?.teams[equipo];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${equipo}** en la modalidad **${modalidad}**.`, ephemeral: true });
    }

    // Parse players from the raw string (e.g., "@player1 @player2")
    const playerMentions = jugadoresRaw.match(/<@!?(\d+)>/g);
    if (!playerMentions || playerMentions.length === 0) {
        return await interaction.reply({ content: '❌ No se encontraron jugadores válidos en la lista proporcionada.', ephemeral: true });
    }

    const newPlayers = playerMentions.map(mention => {
        const id = mention.replace(/<@!?/, '').replace(/>/, '');
        // Attempt to get username from guild members cache or fetch
        const member = interaction.guild.members.cache.get(id);
        const name = member ? member.user.username : `Unknown User (${id})`;
        return { id, name, rol: null }; // Default role to null
    });

    teamData.jugadores_habilitados = newPlayers;
    teamData.articulos_usados = articulos; // Set articles used directly
    await saveData();
    await updateTeamMessage(interaction.guild, modalityKey, equipo);

    await interaction.reply({ content: `✅ Plantilla de **${equipo}** sincronizada con éxito. Jugadores: ${teamData.jugadores_habilitados.length}. Artículos usados: ${teamData.articulos_usados}.`, ephemeral: true });
}

async function handleOtorgarArticulosCommand(interaction) {
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modalidad = interaction.options.getString('modalidad');
    const equipo = interaction.options.getString('equipo');
    const cantidad = interaction.options.getInteger('cantidad');

    const modalityKey = modalidad.toLowerCase();
    const teamData = ligaData[modalityKey]?.teams[equipo];

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo **${equipo}** en la modalidad **${modalidad}**.`, ephemeral: true });
    }

    // Since articulos_usados tracks used articles, granting more means reducing the 'used' count.
            teamData.articulos_usados = Math.max(0, teamData.articulos_usados - cantidad);
            await saveData();
            await updateTeamMessage(interaction.guild, modalityKey, equipo);
    
            await interaction.reply({ content: `✅ Se han otorgado **${cantidad}** artículos adicionales al equipo **${equipo}** en la modalidad **${modalidad}**. Artículos usados ahora: ${teamData.articulos_usados}.`, ephemeral: true });}

async function handleIniciarTemporadaCommand(interaction) {
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modality = interaction.options.getString('modalidad');
    const modalityKey = modality.toLowerCase();

    // Check if modality exists in ligaData
    if (!ligaData[modalityKey]) {
        return await interaction.reply({ content: `❌ La modalidad **${modality}** no existe.`, ephemeral: true });
    }
    
    if (!marketState.modalities[modalityKey]) {
        marketState.modalities[modalityKey] = {
            season_state: 'TEMPORADA_REGULAR_MERCADO_CERRADO',
            mid_season_free_signings_used: 0,
            season_start_date: new Date().toISOString().split('T')[0]
        };
    } else {
        marketState.modalities[modalityKey].season_state = 'TEMPORADA_REGULAR_MERCADO_CERRADO';
        marketState.modalities[modalityKey].mid_season_free_signings_used = 0;
        marketState.modalities[modalityKey].season_start_date = new Date().toISOString().split('T')[0];
    }

    fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2));

    await interaction.reply({ content: `✅ Temporada iniciada para la modalidad **${modality}**. El mercado libre está cerrado y los contadores de fichajes libres de mitad de temporada han sido reiniciados.`, ephemeral: true });
}

async function handleFinalizarTemporadaCommand(interaction) {
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const modality = interaction.options.getString('modalidad');
    const modalityKey = modality.toLowerCase();

    // Check if modality exists in ligaData
    if (!ligaData[modalityKey]) {
        return await interaction.reply({ content: `❌ La modalidad **${modality}** no existe.`, ephemeral: true });
    }

    if (!marketState.modalities[modalityKey]) {
        marketState.modalities[modalityKey] = {
            season_state: 'PRETEMPORADA',
            mid_season_free_signings_used: 0,
            season_start_date: new Date().toISOString().split('T')[0]
        };
    } else {
        marketState.modalities[modalityKey].season_state = 'PRETEMPORADA';
        marketState.modalities[modalityKey].mid_season_free_signings_used = 0; // Reset for next season
        marketState.modalities[modalityKey].season_start_date = new Date().toISOString().split('T')[0];
    }

    fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2));

    await interaction.reply({ content: `✅ Temporada finalizada para la modalidad **${modality}**. El mercado libre ilimitado (pretemporada) ha sido abierto.`, ephemeral: true });
}

async function handleHelpCommand(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Comandos del Bot de Fichajes')
        .setDescription('Aquí tienes una lista de los comandos que puedes usar:')
        .addFields(
            { name: '/fichar <jugador> [rol]', value: 'Enviar una solicitud de fichaje a un jugador. (Solo capitanes o autorizados)' },
            { name: '/bajar <jugador> [motivo]', value: 'Bajar a un jugador de tu equipo. (Solo capitanes o autorizados)' },
            { name: '/cancelar [motivo]', value: 'Darte de baja de tu equipo actual.' },
            { name: '/info <jugador>', value: 'Muestra la información de un jugador (equipo, modalidad, rol).' },
            { name: '/plantilla <modalidad> <equipo>', value: 'Muestra la plantilla de un equipo específico.' },
            { name: '/rol <jugador> <rol>', value: 'Modifica el rol de un jugador en tu plantilla. (Solo capitanes o autorizados)' },
            { name: '/establecer_plantilla', value: 'Crea el mensaje de plantilla en este canal. (Solo Admin/Mod)' },
            { name: '/equipo crear/eliminar <nombre> <modalidad>', value: 'Crea o elimina un equipo en una modalidad. (Solo Admin/Mod)' },
            { name: '/restablecer_plantilla <modalidad> <equipo>', value: 'Elimina TODOS los jugadores de una plantilla. (Solo Admin/Mod)' },
            { name: '/sincronizar_plantilla <modalidad> <equipo> <jugadores>', value: 'Sincroniza la plantilla con una lista de jugadores. (Solo Admin/Mod)' },
            { name: '/otorgar_articulos <modalidad> <equipo> <cantidad>', value: 'Otorga artículos a un equipo. (Solo Admin/Mod)' },
            { name: '/mercado abrir/cerrar <modalidad>', value: 'Abre o cierra el mercado de fichajes. (Solo Admin/Mod)' },
            { name: '/iniciar_temporada <modalidad>', value: 'Inicia una nueva temporada. (Solo Admin/Mod)' },
            { name: '/finalizar_temporada <modalidad>', value: 'Finaliza la temporada actual. (Solo Admin/Mod)' },
            { name: '/help', value: 'Muestra esta lista de comandos.' }
        );

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleHelpCapitanCommand(interaction) {
    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Comandos para Capitanes')
        .setDescription('Estos son los comandos que puedes usar como capitán:')
        .addFields(
            { name: '/fichar <jugador> [rol]', value: 'Enviar una solicitud de fichaje a un jugador.' },
            { name: '/bajar <jugador> [motivo]', value: 'Bajar a un jugador de tu equipo.' },
            { name: '/rol <jugador> <rol>', value: 'Modifica el rol de un jugador en tu plantilla.' },
            { name: '/cancelar [motivo]', value: 'Darte de baja de tu equipo actual.' }
        );

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleMercadoCommand(interaction) {
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ Solo los usuarios con el rol de Moderador pueden usar este comando.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
        const modality = interaction.options.getString('modalidad');
    
        if (!modality) {
          await interaction.reply({ content: 'Por favor, especifica una modalidad (vender o comprar).', ephemeral: true });
          return;
        }
    
            const modalityKey = modality.toLowerCase();
        
            // Check if modality exists in ligaData
            if (!ligaData[modalityKey]) {
                return await interaction.reply({ content: `❌ La modalidad **${modality}** no existe.`, ephemeral: true });
            }
    if (!marketState.modalities[modalityKey]) {
        marketState.modalities[modalityKey] = {
            season_state: 'TEMPORADA_REGULAR_MERCADO_CERRADO',
            mid_season_free_signings_used: 0,
            season_start_date: new Date().toISOString().split('T')[0]
        };
    }

    if (subcommand === 'abrir') {
        marketState.modalities[modalityKey].season_state = 'TEMPORADA_REGULAR_MERCADO_ABIERTO';
        fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2));
        await interaction.reply({ content: `✅ El mercado de fichajes libres ha sido abierto para la modalidad **${modality}** (5 fichajes).`, ephemeral: true });
    } else if (subcommand === 'cerrar') {
        marketState.modalities[modalityKey].season_state = 'TEMPORADA_REGULAR_MERCADO_CERRADO';
        fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2));
        await interaction.reply({ content: `❌ El mercado de fichajes libres ha sido cerrado para la modalidad **${modality}**.`, ephemeral: true });
    }
}

async function handlePublicSigningResponse(interaction, accepted, signingId) {
    const signingData = pendingSignings.get(signingId);
    if (!signingData || interaction.user.id !== signingData.targetUserId) {
        return await interaction.reply({ content: '❌ No puedes responder a esta solicitud.', ephemeral: true });
    }

    const requester = await client.users.fetch(signingData.requesterId);
    const targetUser = interaction.user;
    const { equipo, modalidad } = signingData; // Removed tipoEmoji

    const updatedContent = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipo}.\n\n${accepted ? '✅' : '❌'} **${targetUser.username} ${accepted ? 'ACEPTA' : 'RECHAZA'} el fichaje**`; // Removed tipoEmoji
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

    const { equipo, modalidad } = signingInfo; // Removed tipoEmoji
    const embed = new EmbedBuilder()
        .setColor(accepted ? '#00ff00' : '#ff0000')
        .setTitle(`📋 Respuesta de Fichaje`) // Removed tipoEmoji
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
          await logWebhook.send(`\`\`\`${logMessage}\`\`\``);
    } catch (error) {
        console.error(`❌ Error al enviar al webhook de logs:`, error);
    }
}

async function handleAdminConfirmation(interaction) {
    if (!isAuthorized(interaction)) {
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
    
    const teams = leagueData?.teams;
    const foundTeamName = teams ? Object.keys(teams).find(name => name.toLowerCase() === teamName.toLowerCase()) : undefined;
    const teamData = foundTeamName ? teams[foundTeamName] : undefined;

    if (!teamData) {
        return await interaction.reply({ content: `❌ Error: No se encontró el equipo "${teamName}".`, ephemeral: true });
    }
    if (teamData.jugadores_habilitados.length >= leagueData.max_players) {
        return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${foundTeamName} ya tiene ${leagueData.max_players} jugadores.`, ephemeral: true });
    }

    let tipoDeterminado;
    let tipoEmojiDeterminado;
    let marketStateUpdated = false;
    let signing_type;

    const currentModalityMarketState = marketState.modalities[modalityKey];
    if (!currentModalityMarketState) {
        return await interaction.reply({ content: `❌ No se encontró el estado del mercado para la modalidad **${signingData.modalidad}**.`, ephemeral: true });
    }

    switch (currentModalityMarketState.season_state) {
        case 'PRETEMPORADA':
            tipoDeterminado = 'libre';
            tipoEmojiDeterminado = '✍️';
            signing_type = 'pretemporada';
            // No hay límite de fichajes libres en pretemporada, solo el límite de plantilla
            break;
        case 'TEMPORADA_REGULAR_MERCADO_ABIERTO':
            tipoDeterminado = 'libre';
            tipoEmojiDeterminado = '✍️';
            signing_type = 'libre_mitad_temporada';
            if (currentModalityMarketState.mid_season_free_signings_used >= config.MID_SEASON_FREE_SIGNINGS_LIMIT) { // Assuming a new config for this
                return await interaction.reply({ content: `⚠️ **Fichaje no completado.** Ya se han usado los ${config.MID_SEASON_FREE_SIGNINGS_LIMIT} fichajes libres de mitad de temporada para la modalidad **${signingData.modalidad}**.`, ephemeral: true });
            }
            currentModalityMarketState.mid_season_free_signings_used++;
            marketStateUpdated = true;
            break;
        case 'TEMPORADA_REGULAR_MERCADO_CERRADO':
            tipoDeterminado = 'art';
            tipoEmojiDeterminado = '<:ART:1380746252513317015>';
            signing_type = 'art';
            if (teamData.articulos_usados >= config.ARTICLES_LIMIT) {
                return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${foundTeamName} ya usó sus ${config.ARTICLES_LIMIT} artículos.`, ephemeral: true });
            }
            break;
        default:
            return await interaction.reply({ content: '❌ Estado de mercado desconocido. No se puede procesar el fichaje.', ephemeral: true });
    }

    // Apply the signing based on the determined type
    if (tipoDeterminado === 'art') {
        teamData.articulos_usados++;
    } else if (tipoDeterminado === 'libre') {
        // For PRETEMPORADA, no team-specific counter for free signings
        // For TEMPORADA_REGULAR_MERCADO_ABIERTO, the global counter is used
    }
    
    teamData.jugadores_habilitados.push({ id: targetUser.id, name: targetUser.username, rol: signingData.rol, fichaje: signing_type });
    saveData(); // Save ligaData

    if (marketStateUpdated) {
        fs.writeFileSync('./market_state.json', JSON.stringify(marketState, null, 2)); // Save updated marketState
    }

    await updateTeamMessage(interaction.guild, modalityKey, foundTeamName);
    await removePendingSigning(signingId);

    const logMessage = `✅ **FICHAJE:** ${targetUser.username} se une a **${foundTeamName}**. (Tipo: ${tipoDeterminado}, Rol: ${signingData.rol || 'Jugador'}). Confirmado por ${interaction.user.username}.`;
    await logMovement(logMessage);

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor('#FFD700')
        .addFields({ name: '✅ Confirmado por', value: `${interaction.user} - <t:${Math.floor(Date.now() / 1000)}:F>`, inline: false })
        .setFooter({ text: `Fichaje ${tipoDeterminado} confirmado en la planilla` });

    await interaction.update({ embeds: [updatedEmbed], components: [] });
}

async function handleActualizarTodasPlanillasCommand(interaction) {
    if (!isModerator(interaction.member)) {
        return await interaction.reply({ content: '❌ Solo los Moderadores pueden ejecutar este comando.', ephemeral: true });
    }

    await interaction.reply({ content: '⏳ Migrando todas las plantillas al nuevo formato... Esto puede tardar un momento.', ephemeral: true });

    let successCount = 0;
    let errorCount = 0;

    const guild = interaction.guild;

    for (const modalityKey in ligaData) {
        for (const teamName in ligaData[modalityKey].teams) {
            const teamData = ligaData[modalityKey].teams[teamName];
            if (teamData.channel_id && teamData.message_id) {
                try {
                    const channel = await guild.channels.fetch(teamData.channel_id);
                    const message = await channel.messages.fetch(teamData.message_id);
                    const messageContent = await buildTeamPlainText(guild, modalityKey, teamName);
                    await message.edit({ content: messageContent, embeds: [] });
                    successCount++;
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Error al actualizar plantilla de ${teamName} (${modalityKey}):`, error);
                    errorCount++;
                }
            }
        }
    }

    await interaction.followUp({ content: `✅ Migración completada. ${successCount} plantillas actualizadas. ${errorCount} errores.`, ephemeral: true });
}

async function handleEstablecerPlantillaCommand(interaction) {
    if (!isAuthorized(interaction)) {
        return await interaction.reply({ content: '❌ No tienes permisos.', ephemeral: true });
    }

    const { equipo, modalidad } = extractTeamAndModality(interaction);
    const modalityKey = modalidad.toLowerCase();
    const teamName = equipo;

    const teams = ligaData[modalityKey]?.teams;
    const foundTeamName = teams ? Object.keys(teams).find(name => name.toLowerCase() === teamName.toLowerCase()) : undefined;
    const teamData = foundTeamName ? teams[foundTeamName] : undefined;

    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}".`, ephemeral: true });
    }

    const messageContent = await buildTeamPlainText(interaction.guild, modalityKey, foundTeamName);
    const message = await interaction.channel.send({ content: messageContent });

    teamData.channel_id = message.channel.id;
    teamData.message_id = message.id;
    saveData();

    await interaction.reply({ content: `✅ Mensaje de plantilla establecido para ${foundTeamName}.`, ephemeral: true });
}

async function buildTeamPlainText(guild, modalityKey, teamName) {
    const leagueData = ligaData[modalityKey];
    const teamData = leagueData.teams[teamName];

    if (teamData.jugadores_habilitados.length > 0) {
        try {
            await guild.members.fetch({ user: teamData.jugadores_habilitados.map(p => p.id) });
        } catch (err) {
            console.error("Error fetching members for plain text message:", err);
        }
    }

    // Sort players by role
    const roleOrder = { 'C': 1, 'SC': 2 };
    const sortedPlayers = [...teamData.jugadores_habilitados].sort((a, b) => {
        const roleA = roleOrder[a.rol] || 3;
        const roleB = roleOrder[b.rol] || 3;
        return roleA - roleB;
    });

    const playerList = sortedPlayers.map((player, index) => {
        const member = guild.members.cache.get(player.id);
        const displayName = member ? member.user.username : player.name;
        let roleTag = player.rol ? (player.rol === 'C' ? ' (C)' : ' (SC)') : '';
        
        let signingEmoji = '';
        if (player.fichaje === 'art') {
            signingEmoji = ' <:ART:1380746252513317015>';
        } else if (player.fichaje === 'libre_mitad_temporada') {
            signingEmoji = ' ✍️';
        }

        return `${index + 1}. <@${player.id}> (${displayName})${roleTag}${signingEmoji}`;
    }).join('\n') || '*Sin jugadores fichados*';

    const title = `**HABILITADOS DE ${teamName.toUpperCase()}**`;
    const header = `# HABILITADOS`;
    const stats = `**${teamData.jugadores_habilitados.length}/${leagueData.max_players} | <:ART:1380746252513317015>: ${teamData.articulos_usados}/${config.ARTICLES_LIMIT}**`;
    const footer = `-# Desvirtuar = aislamiento`;

    return `${title}\n\n${header}\n\n${playerList}\n\n${stats}\n${footer}`;
}

async function buildTeamEmbed(guild, modalityKey, teamName) {
    const leagueData = ligaData[modalityKey];
    const teamData = leagueData.teams[teamName];

    if (teamData.jugadores_habilitados.length > 0) {
        try {
            await guild.members.fetch({ user: teamData.jugadores_habilitados.map(p => p.id) });
        } catch (err) {
            console.error("Error fetching members for embed:", err);
        }
    }

    // Sort players by role
    const roleOrder = { 'C': 1, 'SC': 2 };
    const sortedPlayers = [...teamData.jugadores_habilitados].sort((a, b) => {
        const roleA = roleOrder[a.rol] || 3;
        const roleB = roleOrder[b.rol] || 3;
        return roleA - roleB;
    });

    const playerList = sortedPlayers.map((player, index) => {
        const member = guild.members.cache.get(player.id);
        const displayName = member ? member.user.username : player.name;
        let roleTag = player.rol ? (player.rol === 'C' ? ' (C)' : ' (SC)') : '';

        let signingEmoji = '';
        if (player.fichaje === 'art') {
            signingEmoji = ' <:ART:1380746252513317015>';
        } else if (player.fichaje === 'libre_mitad_temporada') {
            signingEmoji = ' ✍️';
        }

        return `${index + 1}. <@${player.id}> (${displayName})${roleTag}${signingEmoji}`;
    }).join('\n') || '*Sin jugadores fichados*';

    const description = `# HABILITADOS\n\n${playerList}\n\n` +
                        `**${teamData.jugadores_habilitados.length}/${leagueData.max_players} | <:ART:1380746252513317015>: ${teamData.articulos_usados}/${config.ARTICLES_LIMIT}**\n` +
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
        const messageContent = await buildTeamPlainText(guild, modalityKey, teamName);
        await message.edit({ content: messageContent, embeds: [] });
        console.log(`✅ Plantilla de ${teamName} actualizada.`);
    } catch (error) {
        console.error(`❌ Error al actualizar plantilla de ${teamName}:`, error);
    }
}

client.login(config.TOKEN);