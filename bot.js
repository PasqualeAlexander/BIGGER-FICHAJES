const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Almacena las solicitudes de fichaje pendientes
const pendingSignings = new Map();

client.once('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    
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
        console.log('🔄 Limpiando comandos existentes...');
        await client.application.commands.set([]);
        
        console.log('🔄 Registrando comandos globalmente...');
        await client.application.commands.set(commands);
        
        // También registrar para cada servidor donde está el bot
        console.log('🔄 Registrando comandos en servidores...');
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(commands);
            console.log(`✅ Comandos registrados en ${guild.name}`);
        }
        
        console.log('✅ Comandos registrados exitosamente');
        console.log('📋 Comandos disponibles:', commands.map(cmd => cmd.name).join(', '));
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}

// Manejo de comandos slash
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'fichar') {
        await handleFicharCommand(interaction);
    } else if (interaction.commandName === 'bajar') {
        await handleBajarCommand(interaction);
    }
});

async function handleFicharCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const requester = interaction.user;

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

    try {
        // Crear embed para el DM
        const dmEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📋 Solicitud de Fichaje')
            .setDescription(`¡Hola ${targetUser.username}!\n\nHas recibido una solicitud de fichaje del servidor **${interaction.guild.name}**.`)
            .addFields(
                { name: '👤 Solicitado por:', value: `${requester.username}`, inline: true },
                { name: '🗓️ Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
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
            timestamp: Date.now()
        });

        // Guardar el ID en el mensaje DM para referencia
        dmMessage.signingId = signingId;

        await interaction.reply({
            content: `✅ Se ha enviado una solicitud de fichaje a ${targetUser.username}. Recibirás una notificación cuando responda.`,
            ephemeral: true
        });

    } catch (error) {
        console.error('Error al enviar DM:', error);
        await interaction.reply({
            content: `❌ No se pudo enviar el mensaje directo a ${targetUser.username}. Es posible que tenga los DMs deshabilitados.`,
            ephemeral: true
        });
    }
}

async function handleBajarCommand(interaction) {
    const targetUser = interaction.options.getUser('jugador');
    const motivo = interaction.options.getString('motivo');
    const requester = interaction.user;

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
        await notifyPlayerDismissal(interaction.guild, targetUser, requester, motivo);
        
        await interaction.reply({
            content: `✅ Se ha notificado que ${targetUser.username} fue bajado del equipo.`,
            ephemeral: true
        });

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
        await handleSigningResponse(interaction, true);
    } else if (interaction.customId === 'reject_signing') {
        await handleSigningResponse(interaction, false);
    } else if (interaction.customId.startsWith('admin_confirm_signing_')) {
        await handleAdminConfirmation(interaction);
    }
});

async function handleSigningResponse(interaction, accepted) {
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

        const embed = new EmbedBuilder()
            .setColor(accepted ? '#00ff00' : '#ff0000')
            .setTitle('📋 Respuesta de Fichaje')
            .setDescription(`${targetUser} ha respondido a la solicitud de fichaje.`)
            .addFields(
                { name: '👤 Jugador:', value: `${targetUser}`, inline: true },
                { name: '🎯 Solicitado por:', value: `${requester}`, inline: true },
                { name: '📊 Respuesta:', value: accepted ? '✅ **ACEPTA**' : '❌ **RECHAZA**', inline: true },
                { name: '🗓️ Fecha:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
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

async function notifyPlayerDismissal(guild, targetUser, requester, motivo) {
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
            .setColor('#gold')
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
client.on('error', console.error);

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Iniciar el bot
client.login(config.TOKEN);