const fs = require('fs');
const fs_async = require('fs').promises;
const path = require('path');

// --- Carga de Datos de Plantillas ---
let ligaData;
try {
    ligaData = JSON.parse(fs.readFileSync('liga_data.json', 'utf8'));
} catch (error) {
    console.error("❌ Error al cargar liga_data.json:", error);
    console.error("Asegúrate de que el archivo exista y tenga un formato JSON válido.");
    process.exit(1);
}

async function saveData() {
    try {
        await fs_async.writeFile('liga_data.json', JSON.stringify(ligaData, null, 2));
        console.log('💾 Datos de plantilla guardados en liga_data.json');
    } catch (error) {
        console.error("❌ Error al guardar datos en liga_data.json:", error);
        throw error; // Re-throw the error so bot.js can catch it
    }
}

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

module.exports = {
    ligaData,
    saveData,
    pendingSignings,
    loadPendingSignings,
    addPendingSigning,
    updatePendingSigning,
    removePendingSigning
};
