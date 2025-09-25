const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const config = require('./config.json');

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

    console.log('🔍 Procesando comando /fichar...');
    console.log('📝 Canal actual:', interaction.channel.name);
    console.log('📁 Canal padre:', interaction.channel.parent?.name || 'Sin padre');

    // Verificar que no sea un bot
    if (targetUser.bot) {
        return await interaction.reply({
            content: '❌ No puedes fichar a un bot.',
            ephemeral: true
        });
    }

    // Verificar que no se fiche a sí mismo
    if (targetUser.id === requester.id) {
        return await interaction.reply({
            content: '❌ No puedes ficharte a ti mismo.',
            ephemeral: true
        });
    }

    // Verificar permisos de administrador
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
        !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({
            content: '❌ No tienes permisos para enviar solicitudes de fichaje.',
            ephemeral: true
        });
    }

    // Extraer información del equipo y modalidad
    const equipoInfo = extractTeamAndModality(interaction);
    console.log('🛡️ Información extraída:', equipoInfo);

    try {
        // Crear embed para el DM
        const dmEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📋 Solicitud de Fichaje')
            .setDescription(`¡Hola ${targetUser.username}!\n\nHas recibido una solicitud de fichaje del servidor **${interaction.guild.name}**.`)
            .addFields(
                { name: '👤 Solicitado por:', value: `${requester.username}`, inline: true },
                { name: '🗺️ Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '🛡️ Equipo:', value: `${equipoInfo.equipo}`, inline: true },
                { name: '🎮 Modalidad:', value: `${equipoInfo.modalidad}`, inline: true }
            )
            .setThumbnail(interaction.guild.iconURL())
            .setFooter({ text: 'Responde con los botones de abajo' });

        // Crear botones
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('accept_signing')
                    .setLabel('Acepto fichar')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('reject_signing')
                    .setLabel('Rechazo')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

        // Intentar enviar DM
        const dmChannel = await targetUser.createDM();
        const dmMessage = await dmChannel.send({
            embeds: [dmEmbed],
            components: [row]
        });

        // Guardar información de la solicitud
        const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;
        pendingSignings.set(signingId, {
            targetUserId: targetUser.id,
            requesterId: requester.id,
            guildId: interaction.guild.id,
            dmMessageId: dmMessage.id,
            timestamp: Date.now(),
            equipo: equipoInfo.equipo,
            modalidad: equipoInfo.modalidad
        });

        // Guardar el ID en el mensaje DM para referencia
        dmMessage.signingId = signingId;

        // Crear botones para el mensaje público
        const publicRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`public_accept_${signingId}`)
                    .setLabel('Acepto fichar')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`public_reject_${signingId}`)
                    .setLabel('Rechazo')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

        // Enviar mensaje público informando sobre la solicitud de fichaje
        const mensajePublico = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo} en modalidad ${equipoInfo.modalidad}.\n-# Se está esperando una respuesta por MD para confirmar la subida del jugador a la plantilla.\n-# O puedes responder directamente con los botones de abajo:`;
        
        const publicMessage = await interaction.reply({
            content: mensajePublico,
            components: [publicRow],
            fetchReply: true
        });

        // Guardar el ID del mensaje público para referencia
        const updatedSigningData = pendingSignings.get(signingId);
        if (updatedSigningData) {
            updatedSigningData.publicMessageId = publicMessage.id;
            updatedSigningData.channelId = interaction.channel.id;
            pendingSignings.set(signingId, updatedSigningData);
        }

    } catch (error) {
        console.error('Error al enviar DM, usando fallback a mensaje público:', error);

        // Crear una solicitud pendiente sin DM
        const signingId = `${interaction.guild.id}_${targetUser.id}_${Date.now()}`;
        pendingSignings.set(signingId, {
            targetUserId: targetUser.id,
            requesterId: requester.id,
            guildId: interaction.guild.id,
            dmMessageId: null,
            timestamp: Date.now(),
            equipo: equipoInfo.equipo,
            modalidad: equipoInfo.modalidad
        });

        // Crear botones públicos
        const publicRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`public_accept_${signingId}`)
                    .setLabel('Acepto fichar')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`public_reject_${signingId}`)
                    .setLabel('Rechazo')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

        // Mensaje público mencionando al jugador para que pueda responder
        const mensajePublico = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${equipoInfo.equipo} en modalidad ${equipoInfo.modalidad}.\n-# No se pudo enviar DM al jugador, puede responder aquí con los botones de abajo:`;

        const publicMessage = await interaction.reply({
            content: mensajePublico,
            components: [publicRow],
            fetchReply: true
        });

        // Guardar referencia al mensaje público
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

    // Extraer información del equipo y modalidad para la baja
    const equipoInfoBaja = extractTeamAndModality(interaction);
    console.log('🛡️ Información extraída para baja:', equipoInfoBaja);

    // Verificar que no sea un bot
    if (targetUser.bot) {
        return await interaction.reply({
            content: '❌ No puedes bajar a un bot.',
            ephemeral: true
        });
    }

    // Verificar permisos de administrador
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
        !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
        return await interaction.reply({
            content: '❌ No tienes permisos para bajar jugadores.',
            ephemeral: true
        });
    }

    try {
        // Crear el embed de baja
        const embed = new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('📉 Baja de Jugador')
            .setDescription(`Se ha dado de baja a un jugador del equipo.`)
            .addFields(
                { name: '👤 Jugador bajado:', value: `${targetUser}`, inline: true },
                { name: '🛡️ Bajado por:', value: `${requester}`, inline: true },
                { name: '📅 Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setFooter({ text: 'Baja procesada' });

        // Agregar motivo si fue proporcionado
        if (motivo) {
            embed.addFields({
                name: '📝 Motivo:',
                value: motivo,
                inline: false
            });
        }

        // Enviar embed al canal donde se ejecutó el comando
        await interaction.reply({
            embeds: [embed]
        });

        // También notificar al canal de bajas si está configurado (incluye equipo y modalidad)
        await notifyPlayerDismissal(interaction.guild, targetUser, requester, motivo, equipoInfoBaja);

    } catch (error) {
        console.error('Error al procesar baja de jugador:', error);
        await interaction.reply({
            content: '❌ Ocurrió un error al procesar la baja del jugador.',
            ephemeral: true
        });
    }
}

// Manejo de interacciones con botones
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'accept_signing') {
        await handleSigningResponse(interaction, true, 'dm');
    } else if (interaction.customId === 'reject_signing') {
        await handleSigningResponse(interaction, false, 'dm');
    } else if (interaction.customId.startsWith('public_accept_')) {
        const signingId = interaction.customId.replace('public_accept_', '');
        await handlePublicSigningResponse(interaction, true, signingId);
    } else if (interaction.customId.startsWith('public_reject_')) {
        const signingId = interaction.customId.replace('public_reject_', '');
        await handlePublicSigningResponse(interaction, false, signingId);
    } else if (interaction.customId.startsWith('admin_confirm_signing_')) {
        await handleAdminConfirmation(interaction);
    }
});

async function handlePublicSigningResponse(interaction, accepted, signingId) {
    const userId = interaction.user.id;
    
    console.log(`🔄 Respuesta pública recibida de ${interaction.user.username}: ${accepted ? 'ACEPTA' : 'RECHAZA'}`);
    
    const signingData = pendingSignings.get(signingId);
    
    if (!signingData) {
        return await interaction.reply({
            content: '❌ No se encontró la solicitud de fichaje correspondiente.',
            ephemeral: true
        });
    }
    
    // Verificar que solo el jugador objetivo puede responder
    if (userId !== signingData.targetUserId) {
        return await interaction.reply({
            content: '❌ Solo el jugador que fue fichado puede responder a esta solicitud.',
            ephemeral: true
        });
    }
    
    try {
        const guild = await client.guilds.fetch(signingData.guildId);
        const requester = await client.users.fetch(signingData.requesterId);
        const targetUser = interaction.user;
        
        // Actualizar el mensaje público
        const updatedContent = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${signingData.equipo} en modalidad ${signingData.modalidad}.\n\n${accepted ? '✅' : '❌'} **${targetUser.username} ${accepted ? 'ACEPTA' : 'RECHAZA'} el fichaje**`;
        
        await interaction.update({
            content: updatedContent,
            components: [] // Remover botones
        });
        
        // Enviar notificación al canal de fichajes
        await notifyAdmins(guild, targetUser, requester, accepted, signingId);
        
        // Actualizar DM si existe
        try {
            const dmChannel = await targetUser.createDM();
            const dmMessage = await dmChannel.messages.fetch(signingData.dmMessageId);
            
            const updatedEmbed = EmbedBuilder.from(dmMessage.embeds[0])
                .setColor(accepted ? '#00ff00' : '#ff0000')
                .addFields({
                    name: '📊 Respuesta:',
                    value: accepted ? '✅ **ACEPTA** fichar' : '❌ **RECHAZA** fichar',
                    inline: false
                });
            
            await dmMessage.edit({
                embeds: [updatedEmbed],
                components: []
            });
        } catch (dmError) {
            console.log('ℹ️ No se pudo actualizar el DM (probablemente no existe):', dmError.message);
        }
        
        // Si fue rechazado, remover de pendientes
        if (!accepted) {
            pendingSignings.delete(signingId);
        }
        
    } catch (error) {
        console.error('Error al procesar respuesta pública de fichaje:', error);
        await interaction.reply({
            content: '❌ Ocurrió un error al procesar tu respuesta.',
            ephemeral: true
        });
    }
}

async function handleSigningResponse(interaction, accepted, source = 'dm') {
    const userId = interaction.user.id;
    
    // Buscar la solicitud correspondiente
    let signingData = null;
    let signingId = null;
    
    for (const [id, data] of pendingSignings) {
        if (data.targetUserId === userId && data.dmMessageId === interaction.message.id) {
            signingData = data;
            signingId = id;
            break;
        }
    }

    if (!signingData) {
        return await interaction.reply({
            content: '❌ No se encontró la solicitud de fichaje correspondiente.',
            ephemeral: true
        });
    }

    try {
        const guild = await client.guilds.fetch(signingData.guildId);
        const requester = await client.users.fetch(signingData.requesterId);
        const targetUser = interaction.user;

        // Actualizar el mensaje DM
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(accepted ? '#00ff00' : '#ff0000')
            .addFields({
                name: '📊 Respuesta:',
                value: accepted ? '✅ **ACEPTA** fichar' : '❌ **RECHAZA** fichar',
                inline: false
            });

        await interaction.update({
            embeds: [updatedEmbed],
            components: [] // Remover botones
        });

        // También actualizar el mensaje público en el foro si existe
        try {
            const channelId = signingData.channelId;
            const publicMessageId = signingData.publicMessageId;
            if (channelId && publicMessageId) {
                const channel = await guild.channels.fetch(channelId);
                if (channel) {
                    const updatedContent = `📝 <@${requester.id}> quiere fichar a <@${targetUser.id}> para ${signingData.equipo} en modalidad ${signingData.modalidad}.\n\n${accepted ? '✅' : '❌'} **${targetUser.username} ${accepted ? 'ACEPTA' : 'RECHAZA'} el fichaje**`;
                    const publicMsg = await channel.messages.fetch(publicMessageId);
                    await publicMsg.edit({
                        content: updatedContent,
                        components: []
                    });
                }
            }
        } catch (updateErr) {
            console.log('ℹ️ No se pudo actualizar el mensaje público del foro:', updateErr.message);
        }

        // Enviar notificación al canal de fichajes
        await notifyAdmins(guild, targetUser, requester, accepted, signingId);

        // Si fue rechazado, remover de pendientes
        if (!accepted) {
            pendingSignings.delete(signingId);
        }

    } catch (error) {
        console.error('Error al procesar respuesta de fichaje:', error);
        await interaction.reply({
            content: '❌ Ocurrió un error al procesar tu respuesta.',
            ephemeral: true
        });
    }
}

async function notifyAdmins(guild, targetUser, requester, accepted, signingId) {
    const signingsChannelId = config.SIGNINGS_CHANNEL_ID;
    
    if (!signingsChannelId) {
        console.error('❌ SIGNINGS_CHANNEL_ID no configurado en config.json');
        return;
    }

    try {
        const signingsChannel = await guild.channels.fetch(signingsChannelId);
        
        if (!signingsChannel) {
            console.error('❌ No se encontró el canal de fichajes');
            return;
        }

        // Obtener información guardada del equipo y modalidad
        const signingData = pendingSignings.get(signingId);
        const equipo = signingData?.equipo || 'Equipo no identificado';
        const modalidad = signingData?.modalidad || 'MODALIDAD';

        const embed = new EmbedBuilder()
            .setColor(accepted ? '#00ff00' : '#ff0000')
            .setTitle('📋 Respuesta de Fichaje')
            .setDescription(`${targetUser} ha respondido a la solicitud de fichaje.`)
            .addFields(
                { name: '👤 Jugador:', value: `${targetUser}`, inline: true },
                { name: '🎯 Solicitado por:', value: `${requester}`, inline: true },
                { name: '📊 Respuesta:', value: accepted ? '✅ **ACEPTA**' : '❌ **RECHAZA**', inline: true },
                { name: '🛡️ Equipo:', value: `${equipo}`, inline: true },
                { name: '🎮 Modalidad:', value: `${modalidad}`, inline: true },
                { name: '🗺️ Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setFooter({ text: accepted ? 'Reacciona con ✅ para confirmar el fichaje en la planilla' : 'Fichaje rechazado' });

        let components = [];
        if (accepted) {
            const confirmRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`admin_confirm_signing_${signingId}`)
                        .setLabel('Confirmar en planilla')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success)
                );
            components = [confirmRow];
        }

        await signingsChannel.send({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        console.error('Error al notificar a administradores:', error);
    }
}

async function notifyPlayerDismissal(guild, targetUser, requester, motivo, equipoInfo) {
    const dismissalsChannelId = config.DISMISSALS_CHANNEL_ID;
    
    if (!dismissalsChannelId) {
        console.error('❌ DISMISSALS_CHANNEL_ID no configurado en config.json');
        return;
    }

    try {
        const dismissalsChannel = await guild.channels.fetch(dismissalsChannelId);
        
        if (!dismissalsChannel) {
            console.error('❌ No se encontró el canal de bajas');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#ff4444')
            .setTitle('📉 Baja de Jugador')
            .setDescription(`Se ha dado de baja a un jugador del equipo.`)
            .addFields(
                { name: '👤 Jugador bajado:', value: `${targetUser}`, inline: true },
                { name: '🛡️ Bajado por:', value: `${requester}`, inline: true },
                { name: '🛡️ Equipo:', value: `${equipoInfo?.equipo || 'Equipo no identificado'}`, inline: true },
                { name: '🎮 Modalidad:', value: `${equipoInfo?.modalidad || 'MODALIDAD'}`, inline: true },
                { name: '📅 Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setFooter({ text: 'Baja procesada' });

        // Agregar motivo si fue proporcionado
        if (motivo) {
            embed.addFields({
                name: '📝 Motivo:',
                value: motivo,
                inline: false
            });
        }

        await dismissalsChannel.send({
            embeds: [embed]
        });

    } catch (error) {
        console.error('Error al notificar baja de jugador:', error);
    }
}

async function handleAdminConfirmation(interaction) {
    try {
        // Extraer el signing ID del custom ID
        const signingId = interaction.customId.replace('admin_confirm_signing_', '');
        console.log(`🔍 Buscando signing ID: ${signingId}`);
        console.log(`🗺 Solicitudes pendientes: ${Array.from(pendingSignings.keys()).join(', ')}`);
        
        const signingData = pendingSignings.get(signingId);

        if (!signingData) {
            return await interaction.reply({
                content: `❌ No se encontró la solicitud de fichaje correspondiente. ID buscado: ${signingId}`,
                ephemeral: true
            });
        }

        // Verificar permisos de administrador
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && 
            !config.ADMIN_ROLE_IDS.some(roleId => interaction.member.roles.cache.has(roleId))) {
            return await interaction.reply({
                content: '❌ No tienes permisos para confirmar fichajes.',
                ephemeral: true
            });
        }

        const targetUser = await client.users.fetch(signingData.targetUserId);
        const admin = interaction.user;

        // Actualizar el embed
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#FFD700')
            .addFields({
                name: '✅ Confirmado por:',
                value: `${admin} - <t:${Math.floor(Date.now() / 1000)}:F>`,
                inline: false
            })
            .setFooter({ text: 'Fichaje confirmado en la planilla' });

        await interaction.update({
            embeds: [updatedEmbed],
            components: [] // Remover botones
        });

        // Remover de solicitudes pendientes
        pendingSignings.delete(signingId);

        console.log(`✅ Fichaje confirmado: ${targetUser.username} por ${admin.username}`);

    } catch (error) {
        console.error('Error completo al confirmar fichaje:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: `❌ Ocurrió un error al confirmar el fichaje: ${error.message}`,
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('Error al enviar respuesta de error:', replyError);
        }
    }
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
