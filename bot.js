const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

let ligaData;
try {
    ligaData = JSON.parse(fs.readFileSync('liga_data.json', 'utf8'));
} catch (error) {
    console.error("Error al cargar liga_data.json:", error);
    process.exit(1);
}

function saveData() {
    try {
        fs.writeFileSync('liga_data.json', JSON.stringify(ligaData, null, 2));
        console.log('💾 Datos guardados en liga_data.json');
    } catch (error) {
        console.error("Error al guardar datos en liga_data.json:", error);
    }
}

console.log('🚀 Iniciando bot...');
console.log('🔑 Token configurado:', config.TOKEN ? config.TOKEN.substring(0, 20) + '...' : 'NO CONFIGURADO');
console.log('📢 Canal de fichajes:', config.SIGNINGS_CHANNEL_ID || 'NO CONFIGURADO');
console.log('📉 Canal de bajas:', config.DISMISSALS_CHANNEL_ID || 'NO CONFIGURADO');
console.log('👥 Roles admin:', config.ADMIN_ROLE_IDS ? config.ADMIN_ROLE_IDS.length : 0);

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

// Almacena las solicitudes de fichaje pendientes
const pendingSignings = new Map();

// Función para extraer información del equipo y modalidad
function extractTeamAndModality(interaction) {
    const channelName = interaction.channel.name || '';
    const parentName = interaction.channel.parent?.name || '';
    
    console.log('🔎 Analizando nombres:');
    console.log('  Canal:', channelName);
    console.log('  Padre:', parentName);
    
    let equipo = 'Equipo no identificado';
    let modalidad = 'MODALIDAD';
    
    // Extraer nombre del equipo del nombre del canal
    // Formato esperado: "Nombre del equipo - ABREVIACION"
    const equipoMatch = channelName.match(/^([^-]+)\s*-/);
    if (equipoMatch) {
        equipo = equipoMatch[1].trim();
        console.log('✅ Equipo encontrado:', equipo);
    } else {
        console.log('⚠️ No se pudo extraer el equipo del canal:', channelName);
    }
    
    // Extraer modalidad del nombre del foro padre
    // Formato esperado: "︲💼┃equipos-biggerx7"
    const modalidadMatch = parentName.match(/equipos-(bigger[\w\d]+)/i);
    if (modalidadMatch) {
        modalidad = modalidadMatch[1].toUpperCase();
        console.log('✅ Modalidad encontrada:', modalidad);
    } else {
        console.log('⚠️ No se pudo extraer la modalidad del foro:', parentName);
    }
    
    return { equipo, modalidad };
}

client.once('ready', () => {
    console.log(`✅ Bot conectado exitosamente como ${client.user.tag}`);
    console.log(`🎮 Conectado a ${client.guilds.cache.size} servidor(es)`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`  • ${guild.name} (${guild.id}) - ${guild.memberCount} miembros`);
    });
    
    // Registrar comando slash
    registerCommands();
});

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('fichar')
            .setDescription('Enviar solicitud de fichaje a un jugador')
            .addUserOption(option =>
                option.setName('jugador')
                    .setDescription('El jugador al que quieres enviar la solicitud de fichaje')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('tipo')
                    .setDescription('Tipo de fichaje: art o libre')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('rol')
                    .setDescription('Asignar rol de Capitán o Subcapitán (opcional)')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Capitán', value: 'C' },
                        { name: 'Subcapitán', value: 'SC' }
                    )
            ),
        new SlashCommandBuilder()
            .setName('bajar')
            .setDescription('Notificar que un jugador fue bajado del equipo')
            .addUserOption(option =>
                option.setName('jugador')
                    .setDescription('El jugador que fue bajado')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('motivo')
                    .setDescription('Motivo de la baja (opcional)')
                    .setRequired(false)
            ),
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
            )
    ];

    try {
        console.log('🗑️ ELIMINANDO TODOS los comandos globales...');
        await client.application.commands.set([]);
        
        console.log('🗑️ ELIMINANDO TODOS los comandos de servidores...');
        for (const guild of client.guilds.cache.values()) {
            console.log(`🗑️ Eliminando comandos de ${guild.name}...`);
            await guild.commands.set([]);
        }
        
        console.log('⏳ Esperando 3 segundos para asegurar limpieza...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('🆕 REGISTRANDO comandos SOLO en el servidor principal...');
        const mainGuild = client.guilds.cache.get('1210830619228119090'); // LNB
        if (mainGuild) {
            await mainGuild.commands.set(commands);
            console.log(`✅ Comandos registrados SOLO en ${mainGuild.name}`);
        } else {
            console.error('❌ No se encontró el servidor principal!');
        }
        
        console.log('✅ Comandos registrados exitosamente');
        console.log('📋 Comandos disponibles:', commands.map(cmd => cmd.name).join(', '));
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}

// Manejo de comandos slash
console.log('🔧 Registrando event listener para interactionCreate...');
client.on('interactionCreate', async interaction => {
    console.log('🚀 ¡INTERACCIÓN RECIBIDA!');
    try {
        console.log('🔄 Detalles:', {
            tipo: interaction.type,
            comando: interaction.commandName || 'N/A',
            usuario: interaction.user?.username || 'N/A',
            canal: interaction.channel?.name || 'N/A',
            servidor: interaction.guild?.name || 'N/A'
        });
        
        if (!interaction.isChatInputCommand()) {
            console.log('ℹ️ No es comando de chat, ignorando');
            return;
        }
        
        console.log(`⚙️ Procesando comando: /${interaction.commandName}`);

        if (interaction.commandName === 'fichar') {
            await handleFicharCommand(interaction);
        } else if (interaction.commandName === 'bajar') {
            await handleBajarCommand(interaction);
        } else if (interaction.commandName === 'establecer_plantilla') {
            await handleEstablecerPlantillaCommand(interaction);
        } else if (interaction.commandName === 'cancelar') {
            await handleCancelarCommand(interaction);
        } else {
            console.log(`⚠️ Comando desconocido: ${interaction.commandName}`);
        }
    } catch (error) {
        console.error('❌ Error procesando interacción:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Ocurrió un error interno. Inténtalo de nuevo.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('❌ Error enviando respuesta de error:', replyError);
        }
    }
});

async function handleFicharCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const requester = interaction.user;
    const tipoRaw = interaction.options.getString('tipo');
    const rol = interaction.options.getString('rol') || null; // Nuevo

    const tipo = (tipoRaw || '').trim().toLowerCase();
    if (!['art', 'libre'].includes(tipo)) {
        return await interaction.reply({
            content: '❌ El parámetro "tipo" debe ser "art" o "libre".',
            ephemeral: true
        });
    }
    const tipoEmoji = tipo === 'art' ? '<:ART:1380746252513317015>' : '✍️';

    if (targetUser.bot) {
        return await interaction.reply({ content: '❌ No puedes fichar a un bot.', ephemeral: true });
    }
    if (targetUser.id === requester.id) {
        return await interaction.reply({ content: '❌ No puedes ficharte a ti mismo.', ephemeral: true });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({
            content: '❌ No tienes permisos para enviar solicitudes de fichaje.',
            ephemeral: true
        });
    }

    const equipoInfo = extractTeamAndModality(interaction);

    try {
        const dmEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`${tipoEmoji} Solicitud de Fichaje`)
            .setDescription(`¡Hola ${targetUser.username}!\n\nHas recibido una solicitud de fichaje del servidor **${interaction.guild.name}**.`)
            .addFields(
                { name: '👤 Solicitado por:', value: `${requester.username}`, inline: true },
                { name: '🛡️ Equipo:', value: `${equipoInfo.equipo}`, inline: true },
                { name: '🎮 Modalidad:', value: `${equipoInfo.modalidad}`, inline: true },
                { name: '✨ Rol Propuesto:', value: `${rol ? (rol === 'C' ? 'Capitán' : 'Subcapitán') : 'Jugador'}`, inline: true }
            )
            .setThumbnail(interaction.guild.iconURL())
            .setFooter({ text: 'Responde con los botones de abajo' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('accept_signing').setLabel('Acepto fichar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('reject_signing').setLabel('Rechazo').setEmoji('❌').setStyle(ButtonStyle.Danger)
            );

        const dmChannel = await targetUser.createDM();
        const dmMessage = await dmChannel.send({ embeds: [dmEmbed], components: [row] });

        const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;
        pendingSignings.set(signingId, {
            targetUserId: targetUser.id,
            requesterId: requester.id,
            guildId: interaction.guild.id,
            dmMessageId: dmMessage.id,
            timestamp: Date.now(),
            equipo: equipoInfo.equipo,
            modalidad: equipoInfo.modalidad,
            tipo,
            tipoEmoji,
            rol // Nuevo
        });

        dmMessage.signingId = signingId;

        const publicRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(`public_accept_${signingId}`).setLabel('Acepto fichar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`public_reject_${signingId}`).setLabel('Rechazo').setEmoji('❌').setStyle(ButtonStyle.Danger)
            );

        const mensajePublico = `${tipoEmoji} 📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo} en modalidad ${equipoInfo.modalidad}.\n-# Se está esperando una respuesta por MD para confirmar la subida del jugador a la plantilla.\n-# O puedes responder directamente con los botones de abajo:`;

        const publicMessage = await interaction.reply({ content: mensajePublico, components: [publicRow], fetchReply: true });

        const updatedSigningData = pendingSignings.get(signingId);
        if (updatedSigningData) {
            updatedSigningData.publicMessageId = publicMessage.id;
            updatedSigningData.channelId = interaction.channel.id;
            pendingSignings.set(signingId, updatedSigningData);
        }

    } catch (error) {
        console.error('Error al enviar DM, usando fallback a mensaje público:', error);
        const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;
        pendingSignings.set(signingId, {
            targetUserId: targetUser.id,
            requesterId: requester.id,
            guildId: interaction.guild.id,
            dmMessageId: null,
            timestamp: Date.now(),
            equipo: equipoInfo.equipo,
            modalidad: equipoInfo.modalidad,
            tipo,
            tipoEmoji,
            rol // Nuevo
        });

        const publicRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId(`public_accept_${signingId}`).setLabel('Acepto fichar').setEmoji('✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`public_reject_${signingId}`).setLabel('Rechazo').setEmoji('❌').setStyle(ButtonStyle.Danger)
            );

        const mensajePublico = `${tipoEmoji} 📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo} en modalidad ${equipoInfo.modalidad}.\n-# No se pudo enviar DM al jugador, puede responder aquí con los botones de abajo:`;

        const publicMessage = await interaction.reply({ content: mensajePublico, components: [publicRow], fetchReply: true });

        const updatedSigningData = pendingSignings.get(signingId);
        if (updatedSigningData) {
            updatedSigningData.publicMessageId = publicMessage.id;
            updatedSigningData.channelId = interaction.channel.id;
            pendingSignings.set(signingId, updatedSigningData);
        }
    }
}

async function handleBajarCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const motivo = interaction.options.getString('motivo');
    const requester = interaction.user;

    const equipoInfoBaja = extractTeamAndModality(interaction);

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para bajar jugadores.', ephemeral: true });
    }

    try {
        const modalityKey = equipoInfoBaja.modalidad.toLowerCase();
        const teamName = equipoInfoBaja.equipo;
        const teamData = ligaData[modalityKey]?.teams[teamName];

        if (!teamData) {
            return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}" en la modalidad "${modalityKey}".`, ephemeral: true });
        }

        const playerIndex = teamData.jugadores_habilitados.findIndex(p => p.id === targetUser.id);

        if (playerIndex === -1) {
            return await interaction.reply({ content: `❌ El jugador ${targetUser.username} no se encuentra en la lista de habilitados de ${teamName}.`, ephemeral: true });
        }

        teamData.jugadores_habilitados.splice(playerIndex, 1);
        saveData();

        await notifyPlayerDismissal(interaction.guild, targetUser, requester, motivo, equipoInfoBaja);
        await updateTeamMessage(interaction.guild, modalityKey, teamName);

        await interaction.reply({ content: `✅ Jugador ${targetUser.username} ha sido bajado de ${teamName} y la plantilla ha sido actualizada.`, ephemeral: true });

    } catch (error) {
        console.error('Error al procesar baja de jugador:', error);
        await interaction.reply({ content: '❌ Ocurrió un error al procesar la baja del jugador.', ephemeral: true });
    }
}

// ... (código intermedio) ...

async function handleAdminConfirmation(interaction) {
    try {
        const signingId = interaction.customId.replace('admin_confirm_signing_', '');
        const signingData = pendingSignings.get(signingId);

        if (!signingData) {
            return await interaction.reply({ content: `❌ No se encontró la solicitud de fichaje.`, ephemeral: true });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
            !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
            return await interaction.reply({ content: '❌ No tienes permisos para confirmar fichajes.', ephemeral: true });
        }

        const targetUser = await client.users.fetch(signingData.targetUserId);
        const admin = interaction.user;

        const modalityKey = signingData.modalidad.toLowerCase();
        const teamName = signingData.equipo;
        const leagueData = ligaData[modalityKey];
        const teamData = leagueData?.teams[teamName];

        if (!teamData) {
            return await interaction.reply({ content: `❌ Error Crítico: No se encontró el equipo "${teamName}".`, ephemeral: true });
        }

        if (teamData.jugadores_habilitados.length >= leagueData.max_players) {
            return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${teamName} ya tiene ${leagueData.max_players} jugadores.`, ephemeral: true });
        }

        if (signingData.tipo === 'art') {
            if (teamData.articulos_usados >= 4) {
                return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${teamName} ya ha usado sus 4 artículos.`, ephemeral: true });
            }
            teamData.articulos_usados++;
        }

        const newPlayer = { id: targetUser.id, name: targetUser.username, rol: signingData.rol };
        teamData.jugadores_habilitados.push(newPlayer);
        saveData();

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#FFD700')
            .addFields({ name: '✅ Confirmado por:', value: `${admin} - <t:${Math.floor(Date.now() / 1000)}:F>`, inline: false })
            .setFooter({ text: 'Fichaje confirmado en la planilla' });

        await interaction.update({ embeds: [updatedEmbed], components: [] });

        await updateTeamMessage(interaction.guild, modalityKey, teamName);

        pendingSignings.delete(signingId);
        console.log(`✅ Fichaje confirmado: ${targetUser.username} por ${admin.username}`);

    } catch (error) {
        console.error('Error completo al confirmar fichaje:', error);
    }
}

async function handleEstablecerPlantillaCommand(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({ content: '❌ No tienes permisos para usar este comando.', ephemeral: true });
    }

    const { equipo, modalidad } = extractTeamAndModality(interaction);
    const modalityKey = modalidad.toLowerCase();
    const teamName = equipo;

    const teamData = ligaData[modalityKey]?.teams[teamName];
    if (!teamData) {
        return await interaction.reply({ content: `❌ No se encontró el equipo "${teamName}" en la base de datos.`, ephemeral: true });
    }

    const embed = await buildTeamEmbed(modalityKey, teamName);
    const message = await interaction.channel.send({ embeds: [embed] });

    teamData.channel_id = message.channel.id;
    teamData.message_id = message.id;
    saveData();

    await interaction.reply({ content: `✅ Mensaje de plantilla establecido para ${teamName}. A partir de ahora, este mensaje se actualizará automáticamente.`, ephemeral: true });
}

async function buildTeamEmbed(modalityKey, teamName) {
    const leagueData = ligaData[modalityKey];
    const teamData = leagueData.teams[teamName];

    const playerList = teamData.jugadores_habilitados.map((player, index) => {
        let roleTag = '';
        if (player.rol === 'C') roleTag = ' (C)';
        if (player.rol === 'SC') roleTag = ' SC';
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

async function handleCancelarCommand(interaction) {
    const player = interaction.user;
    const motivo = interaction.options.getString('motivo');

    let playerTeamInfo = null;

    // Buscar al jugador en toda la base de datos
    for (const modalityKey in ligaData) {
        for (const teamName in ligaData[modalityKey].teams) {
            const team = ligaData[modalityKey].teams[teamName];
            const playerFound = team.jugadores_habilitados.find(p => p.id === player.id);
            if (playerFound) {
                playerTeamInfo = { modalityKey, teamName, team };
                break;
            }
        }
        if (playerTeamInfo) break;
    }

    if (!playerTeamInfo) {
        return await interaction.reply({ content: '❌ No estás en la plantilla de ningún equipo.', ephemeral: true });
    }

    const { modalityKey, teamName, team } = playerTeamInfo;

    // Eliminar al jugador de la lista
    team.jugadores_habilitados = team.jugadores_habilitados.filter(p => p.id !== player.id);
    saveData();

    console.log(` SELF-DISMISSAL: ${player.username} ha dejado el equipo ${teamName}`);

    // Actualizar el mensaje de plantilla del equipo
    await updateTeamMessage(interaction.guild, modalityKey, teamName);

    // Notificar en el canal de bajas
    const equipoInfo = { equipo: teamName, modalidad: modalityKey.toUpperCase() };
    await notifyPlayerDismissal(interaction.guild, player, player, motivo || 'Baja voluntaria', equipoInfo);

    await interaction.reply({ content: `✅ Has cancelado tu fichaje y te has dado de baja del equipo **${teamName}**.`, ephemeral: true });
}
// Manejo de errores
client.on('error', (error) => {
    console.error('🚫 Error del cliente Discord:', error);
});

// Manejo de warnings
client.on('warn', (warning) => {
    console.warn('⚠️ Warning del cliente Discord:', warning);
});

// Debug para tokens inválidos
client.on('invalidated', () => {
    console.error('🚫 TOKEN INVALIDADO - El token del bot ha sido invalidado por Discord!');
});

// Debug para rate limits
client.on('rateLimit', (rateLimitData) => {
    console.warn('🕰️ Rate limit:', rateLimitData);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Iniciar el bot
client.login(config.TOKEN);
