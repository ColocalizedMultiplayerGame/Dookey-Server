const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.use('/controller', express.static(path.join(__dirname, 'public/controller')));
app.get('/controller', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/controller/index.html'));
});

// Servir le dossier Tutoriel
app.use('/tutoriel', express.static(path.join(__dirname, 'Tutoriel', 'Tutoriel')));

app.use('/display', express.static(path.join(__dirname, 'godot')));
app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, 'godot', 'Dookey Ascension.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for(let i=0; i<8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

const rooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let clientType = url.searchParams.get('clientType');
    
    if (url.pathname === '/game') clientType = 'game';
    if (url.pathname === '/controller') clientType = 'controller';

    if (clientType === 'game') {
        const requestedCode = url.searchParams.get('roomCode');
        const upperReq = requestedCode ? requestedCode.toUpperCase() : null;
        
        let roomCode;
        if (upperReq && rooms.has(upperReq)) {
            roomCode = upperReq;
            const room = rooms.get(roomCode);
            room.gameWs = ws;
            room.isLocked = false;
            console.log(`[Serveur] Le Godot s'est reconnecté à sa salle : ${roomCode}`);
            ws.send(`ROOM_CREATED:${roomCode}`);
            
            for (const pseudo of room.pseudos) {
                ws.send(`PLAYER_JOINED:${pseudo}`);
            }
            
        } else {
            roomCode = generateRoomCode();
            while (rooms.has(roomCode)) {
                roomCode = generateRoomCode();
            }
            console.log(`[Serveur] Le jeu Godot est connecté ! Création de la salle : ${roomCode}`);
            rooms.set(roomCode, { 
                gameWs: ws, 
                controllers: new Set(), 
                isLocked: false, 
                pseudos: new Set(), 
                connectedPseudos: new Set(),
                equipes: new Map(),
                currentTeam: -1
            });
            ws.send(`ROOM_CREATED:${roomCode}`);
        }

        ws.on('message', (message, isBinary) => {
            const msgStr = isBinary ? message.toString('utf8') : message.toString();
            
            if (msgStr.trim() === "LOCK_ROOM") {
                const room = rooms.get(roomCode);
                if (room) {
                    room.isLocked = true;
                    console.log(`[Serveur] Salle ${roomCode} verrouillée.`);
                }
                return;
            }
            
            const room = rooms.get(roomCode);
            if (room) {
                if (msgStr.startsWith('EQUIPES:')) {
                    const payload = msgStr.substring(8);
                    room.equipes.clear();
                    payload.split(',').forEach(entry => {
                        const [pseudo, idx] = entry.split('=');
                        if (pseudo && idx !== undefined) {
                            room.equipes.set(decodeURIComponent(pseudo.trim()), parseInt(idx.trim()));
                        }
                    });
                    console.log(`[Serveur] Équipes enregistrées pour ${roomCode}:`, Object.fromEntries(room.equipes));
                    
                    for (const [ctrlWs, ctrlPseudo] of room.controllerMap || new Map()) {
                        const teamIdx = room.equipes.get(ctrlPseudo);
                        if (ctrlWs.readyState === WebSocket.OPEN && teamIdx !== undefined) {
                            ctrlWs.send(`VOTRE_EQUIPE:${teamIdx}`);
                        }
                    }
                    return;
                }

                if (msgStr.startsWith('NOUVEAU_TOUR:')) {
                    const parts = msgStr.split(':');
                    room.currentTeam = parseInt(parts[1]);
                    console.log(`[Serveur] ${roomCode} - Nouveau tour, équipe index: ${room.currentTeam}`);
                }

                for (const [ctrlWs, ctrlPseudo] of room.controllerMap || new Map()) {
                    if (ctrlWs.readyState === WebSocket.OPEN) {
                        ctrlWs.send(msgStr);
                        if (msgStr.startsWith('NOUVEAU_TOUR:') && room.equipes.size > 0) {
                            const myTeam = room.equipes.get(ctrlPseudo);
                            const isMyTurn = (myTeam !== undefined && myTeam === room.currentTeam);
                            ctrlWs.send(isMyTurn ? 'MON_TOUR' : 'PAS_MON_TOUR');
                        }
                    }
                }
            }
        });

        ws.on('close', () => {
            console.log(`[Serveur] La salle ${roomCode} (Jeu Godot) s'est déconnectée.`);
            if (rooms.has(roomCode)) {
                const room = rooms.get(roomCode);
                for (const ctrlWs of room.controllers) {
                    if (ctrlWs.readyState === WebSocket.OPEN) {
                        ctrlWs.send('JEU_DECONNECTE');
                        ctrlWs.close();
                    }
                }
            }
            rooms.delete(roomCode);
        });

    } else if (clientType === 'controller') {
        const roomCode = url.searchParams.get('roomCode');
        const pseudo = url.searchParams.get('pseudo') || "Joueur Inconnu";

        if (!roomCode || !rooms.has(roomCode.toUpperCase())) {
            console.log(`[Serveur] Rejet : Salle inexistante : ${roomCode}`);
            if(ws.readyState === WebSocket.OPEN) {
                ws.send("ERROR:ROOM_NOT_FOUND");
                ws.close();
            }
            return;
        }

        const upperCode = roomCode.toUpperCase();
        const room = rooms.get(upperCode);
        
        if (room.connectedPseudos.has(pseudo)) {
            console.log(`[Serveur] Rejet : Pseudo ${pseudo} déjà connecté dans ${upperCode}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send("ERROR:PSEUDO_TAKEN");
                ws.close();
            }
            return;
        }
        
        if (room.isLocked && !room.pseudos.has(pseudo)) {
            console.log(`[Serveur] Rejet : Salle verrouillée ${upperCode}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send("ERROR:ROOM_LOCKED");
                ws.close();
            }
            return;
        }

        room.pseudos.add(pseudo);
        room.connectedPseudos.add(pseudo);
        console.log(`[Serveur] Le joueur ${pseudo} a rejoint la salle ${upperCode}`);
        room.controllers.add(ws);
        
        if (!room.controllerMap) room.controllerMap = new Map();
        room.controllerMap.set(ws, pseudo);
        
        if (room.gameWs.readyState === WebSocket.OPEN) {
            room.gameWs.send(`PLAYER_JOINED:${pseudo}`);
        }
        
        ws.send("JOIN_SUCCESS");

        ws.on('message', (message, isBinary) => {
            const msgStr = isBinary ? message.toString('utf8') : message.toString();
            
            const isVote = msgStr.startsWith('CLIC:') || msgStr.startsWith('VOTES:') || msgStr === 'LANCER' || msgStr.startsWith('BOSS_VOTE:');
            if (isVote && room.equipes.size > 0 && room.currentTeam >= 0) {
                const myTeam = room.equipes.get(pseudo);
                if (myTeam === undefined || myTeam !== room.currentTeam) {
                    console.log(`[Serveur] Vote BLOQUÉ de ${pseudo}`);
                    ws.send('PAS_MON_TOUR');
                    return;
                }
            }
            
            if (room.gameWs && room.gameWs.readyState === WebSocket.OPEN) {
                let finalMsg = msgStr;
                if (msgStr.startsWith('BOSS_VOTE:') || msgStr.startsWith('PORTAIL_QTE_VOTE:')) {
                    finalMsg += ":" + pseudo;
                }
                room.gameWs.send(finalMsg);
                console.log(`[Serveur] Message reçu dans ${upperCode} mais le jeu n'est plus connecté.`);
            }
        });

        ws.on('close', () => {
            console.log(`[Serveur] Le joueur ${pseudo} s'est déconnecté de la salle ${upperCode}.`);
            if (rooms.has(upperCode)) {
                const r = rooms.get(upperCode);
                r.controllers.delete(ws);
                r.connectedPseudos.delete(pseudo);
                if (r.controllerMap) r.controllerMap.delete(ws);
                
                if (!r.isLocked) {
                    r.pseudos.delete(pseudo);
                    if (r.gameWs && r.gameWs.readyState === WebSocket.OPEN) {
                        r.gameWs.send(`PLAYER_LEFT:${pseudo}`);
                    }
                }
            }
        });
    }
});

server.listen(port, () => {
    console.log(`[Serveur] Démarré sur le port ${port}`);
});
