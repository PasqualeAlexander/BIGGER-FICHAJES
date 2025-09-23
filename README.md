# Bot de Fichajes para Discord

Bot de Discord diseñado para gestionar fichajes de jugadores con sistema de aprobación por administradores.

## 🎯 Características

- **Comando `/fichar`**: Permite enviar solicitudes de fichaje a jugadores
- **Sistema de DM**: Envía mensajes directos a los jugadores con botones interactivos
- **Notificaciones a administradores**: Canal dedicado para que los admins vean las respuestas
- **Sistema de confirmación**: Los administradores pueden confirmar fichajes en la planilla
- **Embeds informativos**: Mensajes elegantes y organizados
- **Validaciones de seguridad**: No permite fichar bots o a uno mismo

## 🚀 Instalación

### 1. Crear el Bot en Discord Developer Portal

1. Ve a [Discord Developer Portal](https://discord.com/developers/applications)
2. Haz clic en "New Application"
3. Dale un nombre a tu aplicación
4. Ve a la sección "Bot" en el menú lateral
5. Haz clic en "Add Bot"
6. Copia el token del bot (lo necesitarás más tarde)
7. En "Privileged Gateway Intents", activa:
   - `MESSAGE_CONTENT_INTENT`
   - `GUILD_MEMBERS_INTENT`

### 2. Invitar el Bot al Servidor

1. Ve a la sección "OAuth2" > "URL Generator"
2. Selecciona los siguientes scopes:
   - `bot`
   - `applications.commands`
3. Selecciona los siguientes permisos:
   - `Send Messages`
   - `Use Slash Commands`
   - `Embed Links`
   - `Read Message History`
   - `Add Reactions`
   - `Use External Emojis`
4. Copia la URL generada y ábrela para invitar el bot a tu servidor

### 3. Configurar el Entorno

1. Asegúrate de tener Node.js instalado (versión 16.9.0 o superior)
2. Clona o descarga este repositorio
3. Abre una terminal en la carpeta del proyecto
4. Instala las dependencias:
   ```bash
   npm install
   ```

### 4. Configurar el Bot

1. Edita el archivo `config.json`:
   ```json
   {
       "TOKEN": "tu_token_del_bot_aquí",
       "SIGNINGS_CHANNEL_ID": "id_del_canal_de_fichajes",
       "ADMIN_ROLE_IDS": [
           "id_del_rol_admin_1",
           "id_del_rol_admin_2"
       ]
   }
   ```

2. **Para obtener los IDs necesarios:**
   - Activa el "Modo Desarrollador" en Discord (Configuración > Avanzado > Modo desarrollador)
   - Haz clic derecho en el canal de fichajes → "Copiar ID"
   - Haz clic derecho en los roles de admin → "Copiar ID"

### 5. Ejecutar el Bot

```bash
npm start
```

Para desarrollo con auto-recarga:
```bash
npm run dev
```

## 📖 Uso

### Comandos Disponibles

#### `/fichar @jugador`
Envía una solicitud de fichaje al jugador mencionado.

**Ejemplo:**
```
/fichar @JugadorEjemplo
```

### Flujo de Funcionamiento

1. **Solicitud**: Un usuario ejecuta `/fichar @jugador`
2. **DM al jugador**: El bot envía un mensaje directo al jugador con botones para aceptar o rechazar
3. **Respuesta del jugador**: El jugador hace clic en ✅ (acepta) o ❌ (rechaza)
4. **Notificación a admins**: Si acepta, se envía un embed al canal de fichajes
5. **Confirmación admin**: Un administrador hace clic en ✅ para confirmar el fichaje en la planilla
6. **Finalización**: El mensaje se actualiza indicando que fue confirmado

## 🛠️ Configuración

### Archivo config.json

```json
{
    "TOKEN": "Token de tu bot de Discord",
    "SIGNINGS_CHANNEL_ID": "ID del canal donde se notificarán los fichajes",
    "ADMIN_ROLE_IDS": [
        "Lista de IDs de roles que pueden confirmar fichajes"
    ]
}
```

### Permisos Necesarios

El bot necesita los siguientes permisos en tu servidor:
- **Enviar mensajes**
- **Usar comandos de barra**
- **Insertar enlaces**
- **Leer historial de mensajes**
- **Añadir reacciones**
- **Usar emojis externos**

## 🔧 Personalización

### Modificar Embeds

Los embeds se pueden personalizar en el archivo `bot.js`. Busca las funciones:
- `handleFicharCommand()` - Embed del DM
- `notifyAdmins()` - Embed de notificación a admins

### Agregar Funcionalidades

El código está estructurado de manera modular. Puedes:
- Añadir nuevos comandos en la función `registerCommands()`
- Crear nuevos manejadores de eventos
- Implementar base de datos para persistir los fichajes

## 🐛 Solución de Problemas

### El bot no responde a comandos
- Verifica que el token sea correcto
- Asegúrate de que el bot tenga permisos de "Usar comandos de barra"
- Verifica que los intents estén activados en el Developer Portal

### Los DMs no llegan
- El usuario debe permitir mensajes directos de miembros del servidor
- Verifica que el bot pueda enviar mensajes directos

### Las notificaciones no aparecen en el canal
- Verifica que el `SIGNINGS_CHANNEL_ID` sea correcto
- Asegúrate de que el bot tenga permisos en ese canal

### Los administradores no pueden confirmar
- Verifica que los `ADMIN_ROLE_IDS` sean correctos
- Asegúrate de que los usuarios tengan los roles especificados

## 📝 Logs

El bot registra información importante en la consola:
- ✅ Conexión exitosa
- ✅ Comandos registrados
- ✅ Fichajes confirmados
- ❌ Errores diversos

## 🤝 Contribución

Si quieres contribuir al proyecto:
1. Haz un fork del repositorio
2. Crea una rama para tu feature
3. Haz commit de tus cambios
4. Haz push a la rama
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 🆘 Soporte

Si tienes problemas o preguntas:
1. Revisa esta documentación
2. Verifica los logs del bot
3. Asegúrate de que la configuración sea correcta

---

**¡Disfruta gestionando tus fichajes de manera profesional! 🎮⚽**