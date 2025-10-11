const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const fs_async = require('fs').promises;
const path = require('path');
const config = require('./config.json');

// --- Carga de Datos de Plantillas ---
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
        console.log('💾 Datos de plantilla guardados en liga_data.json');
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

// --- Lógica para Solicitudes de Fichaje Pendientes (Persistente) ---
const PENDING_SIGNINGS_FILE = path.join(__dirname, 'pending_signings.json');
const pendingSignings = new Map();

async function loadPendingSignings() {
    try {
        console.log('📂 Cargando solicitudes pendientes desde archivo...');
        const data = await fs_async.readFile(PENDING_SIGNINGS_FILE, 'utf8');
        const signingsData = JSON.parse(data);
        for (const [id, signing] of Object.entries(signingsData)) {
            pendingSignings.set(id, signing);
        }
        console.log(`✅ Cargadas ${pendingSignings.size} solicitudes pendientes`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('ℹ️ No existe archivo de solicitudes pendientes, iniciando con datos vacíos');
        } else {
            console.error('❌ Error cargando solicitudes pendientes:', error);
        }
    }
}

async function savePendingSignings() {
    try {
        const signingsData = Object.fromEntries(pendingSignings);
        await fs_async.writeFile(PENDING_SIGNINGS_FILE, JSON.stringify(signingsData, null, 2), 'utf8');
        console.log(`💾 Guardadas ${pendingSignings.size} solicitudes pendientes`);
    } catch (error) {
        console.error('❌ Error guardando solicitudes pendientes:', error);
    }
}

async function addPendingSigning(signingId, signingData) {
    pendingSignings.set(signingId, signingData);
    await savePendingSignings();
}

async function updatePendingSigning(signingId, signingData) {
    if (pendingSignings.has(signingId)) {
        pendingSignings.set(signingId, signingData);
        await savePendingSignings();
    }
}

async function removePendingSigning(signingId) {
    if (pendingSignings.delete(signingId)) {
        await savePendingSignings();
        return true;
    }
    return false;
}

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
            .addStringOption(option => option.setName('motivo').setDescription('Motivo de tu baja (opcional)').setRequired(false))
    ];

    try {
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
            }
        } catch (error) {
            console.error('❌ Error procesando interacción de comando:', error);
        }
    } else if (interaction.isButton()) {
        try {
            if (interaction.customId.startsWith('admin_confirm_signing_')) {
                await handleAdminConfirmation(interaction);
            } else if (interaction.customId.startsWith('public_accept_') || interaction.customId.startsWith('public_reject_')) {
                const [action, signingId] = interaction.customId.split(/_(.+)/s);
                await handlePublicSigningResponse(interaction, action === 'public_accept', signingId);
            } else if (interaction.customId === 'accept_signing' || interaction.customId === 'reject_signing') {
                await handleSigningResponse(interaction, interaction.customId === 'accept_signing');
            }
        } catch (error) {
            console.error('❌ Error procesando interacción de botón:', error);
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
    if (targetUser.bot || targetUser.id === requester.id) {
        return await interaction.reply({ content: '❌ No puedes ficharte a ti mismo o a un bot.', ephemeral: true });
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
    await interaction.reply({ content: `✅ Te has dado de baja de **${teamName}**.`, ephemeral: true });
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
    if (signingData.tipo === 'art' && teamData.articulos_usados >= 4) {
        return await interaction.reply({ content: `⚠️ **Fichaje no completado.** El equipo ${teamName} ya usó sus 4 artículos.`, ephemeral: true });
    }

    if (signingData.tipo === 'art') {
        teamData.articulos_usados++;
    }
    teamData.jugadores_habilitados.push({ id: targetUser.id, name: targetUser.username, rol: signingData.rol });
    saveData();

    await updateTeamMessage(interaction.guild, modalityKey, teamName);
    await removePendingSigning(signingId);

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