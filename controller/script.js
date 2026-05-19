const inputCode = document.getElementById('input-code');
const inputPseudo = document.getElementById('input-pseudo');
const btnJoin = document.getElementById('btn-join');
const errorLabel = document.getElementById('login-error');

function attemptFillCode() {
    let cp = null;
    try {
        const urlP = new URLSearchParams(window.location.search);
        cp = urlP.get('code');
    } catch(e) {}
    
    if (!cp && window.location.href.includes('code=')) {
        cp = window.location.href.split('code=')[1].split('&')[0];
    }
    
    let savedCode = null;
    let savedPseudo = null;
    try {
        savedCode = sessionStorage.getItem('dookeyRoomCode');
        savedPseudo = sessionStorage.getItem('dookeyPseudo');
    } catch(e) {
        console.warn("sessionStorage non disponible", e);
    }

    if (cp) {
        inputCode.value = cp.toUpperCase();
    } else if (savedCode) {
        inputCode.value = savedCode;
    }
    
    if (savedPseudo) {
        inputPseudo.value = savedPseudo;
    }
    
    return cp;
}

const codeParam = attemptFillCode();

// Sécurité supplémentaire pour les iPhones/navigateurs lents
window.addEventListener('DOMContentLoaded', attemptFillCode);
setTimeout(attemptFillCode, 150);

let socket;
let isGameScreenActive = false;
let animFrameId = null;

let aVoteCeTour = false;
let tourActuel = -1;
let myTeamIndex = -1; // Index de mon équipe (0-3)
let nomEquipeTour = "";
let position = 0;
let direction = 1;
let estArrete = false;
let estVerrouille = false;
let bossAVote = false;  // True quand le joueur a déjà voté pour le boss
let portailAClike = false; // Empêche de cliquer plusieurs fois au QTE
let qteActive = false;
let qtePosition = 0;
let qteDirection = 1;
let qteAnimId = null;

let lastTimeMain = 0;
let lastTimeQte = 0;
let portailInterval = null;
const VITESSE_UNIFORME = 90; // 90% de la largeur de la barre par seconde

const curseur = document.getElementById('curseur');
const cases = document.querySelectorAll('.case-score');

const EQUIPES_COULEURS = ['#b80000', '#414e8e', '#d2ec42', '#12c337'];
const EQUIPES_NOMS     = ['Équipe Rouge', 'Équipe Bleue', 'Équipe Lime', 'Équipe Verte'];

function afficherBadgeEquipe(idx) {
    const badge = document.getElementById('badge-equipe');
    badge.innerText = EQUIPES_NOMS[idx] || ('Équipe ' + (idx + 1));
    badge.style.background = EQUIPES_COULEURS[idx] || '#555';
    badge.style.display = 'block';
}

btnJoin.onclick = () => {
    const code = inputCode.value.trim().toUpperCase();
    const pseudo = inputPseudo.value.trim();
    
    if (code.length === 0 || pseudo.length === 0) {
        errorLabel.innerText = "Veuillez remplir le code et le pseudo.";
        errorLabel.style.display = "block";
        return;
    }
    
    btnJoin.innerText = "Connexion...";
    errorLabel.style.display = "none";
    initWebSocket(code, pseudo);
};

// Reconnexion automatique si on actualise !
let globSavedCode = null;
let globSavedPseudo = null;
try {
    globSavedCode = sessionStorage.getItem('dookeyRoomCode');
    globSavedPseudo = sessionStorage.getItem('dookeyPseudo');
} catch(e) {}

if (globSavedCode && globSavedPseudo && !codeParam) {
    btnJoin.innerText = "Reconnexion...";
    initWebSocket(globSavedCode, globSavedPseudo);
}

function initWebSocket(code, pseudo) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.host}?clientType=controller&roomCode=${code}&pseudo=${encodeURIComponent(pseudo)}`;
    socket = new WebSocket(socketUrl);

    socket.onclose = () => {
        if (isGameScreenActive) {
            document.getElementById('ws-status').style.background = 'red';
            document.getElementById('ws-label').innerText = 'Jeu Déconnecté';
        } else {
            btnJoin.innerText = "Se Connecter";
        }
    };

    socket.onerror = (error) => {
        if (!isGameScreenActive) {
            errorLabel.innerText = "Erreur de connexion au serveur.";
            errorLabel.style.display = "block";
        }
    };

    socket.onmessage = (event) => {
        let data = event.data;

        if (!isGameScreenActive) {
            if (data === "JOIN_SUCCESS") {
                isGameScreenActive = true;
                
                sessionStorage.setItem('dookeyRoomCode', code);
                sessionStorage.setItem('dookeyPseudo', pseudo);
                
                document.getElementById('login-screen').style.display = "none";
                document.getElementById('game-screen').style.display = "block";
                document.getElementById('ws-status').style.background = 'lime';
                document.getElementById('ws-label').innerText = 'Connecté (Attente...)';
                
                melangerChiffres();
                lastTimeMain = performance.now();
                animer(lastTimeMain);
                evaluerVerrouillageBase(); 
            } else if (data === "ERROR:ROOM_NOT_FOUND") {
                sessionStorage.removeItem('dookeyRoomCode');
                sessionStorage.removeItem('dookeyPseudo');
                errorLabel.innerText = "Ce code de salle n'existe pas ou le jeu est fermé.";
                errorLabel.style.display = "block";
                socket.close();
            } else if (data === "ERROR:ROOM_LOCKED") {
                sessionStorage.removeItem('dookeyRoomCode');
                sessionStorage.removeItem('dookeyPseudo');
                errorLabel.innerText = "La partie a déjà commencé, entrée refusée !";
                errorLabel.style.display = "block";
                socket.close();
            } else if (data === "ERROR:PSEUDO_TAKEN") {
                sessionStorage.removeItem('dookeyRoomCode');
                sessionStorage.removeItem('dookeyPseudo');
                errorLabel.innerText = "Ce pseudo est déjà utilisé par un autre joueur !";
                errorLabel.style.display = "block";
                socket.close();
            }
            return;
        }

        if (data === 'BOSS_EVENT') {
            if (myTeamIndex === tourActuel) {
                bossAVote = false;
                document.getElementById('boss-card-0').className = 'boss-card';
                document.getElementById('boss-card-1').className = 'boss-card';
                document.getElementById('boss-vote-status').innerText = 'Touchez une option pour voter...';
                document.getElementById('ecran-cliquable').style.display = 'none';
                const bossScreen = document.getElementById('boss-vote-screen');
                bossScreen.style.display = 'flex';
            } else {
                console.log("[Boss] Une autre équipe est jugée...");
            }
        } else if (data.startsWith('BOSS_RESULT:')) {
            const gagnant = parseInt(data.split(':')[1]);
            document.getElementById('boss-card-' + gagnant).classList.add('winner');
            document.getElementById('boss-card-' + (1 - gagnant)).classList.add('loser');
            document.getElementById('boss-vote-status').innerText = gagnant === 0 ? 'Recul de 10 cases...' : "10% de l'\u00e9quipe \u00e9limin\u00e9e...";

        } else if (data === 'BOSS_END') {
            document.getElementById('boss-vote-screen').style.display = 'none';
            document.getElementById('ecran-cliquable').style.display = '';
            
        } else if (data === 'PORTAIL_QTE_START') {
            if (myTeamIndex === tourActuel) {
                lancerPortailQTE();
            }
        } else if (data === 'PORTAIL_QTE_END') {
            stopPortailQTE();
            
        } else if (data === 'MAJESTUEUX_EVENT_1') {
            if (myTeamIndex === tourActuel) {
                majestueuxAVote = false;
                document.getElementById('maj-title').innerText = '👑 BÉNÉDICTION MAJESTUEUSE 👑';
                const container = document.getElementById('maj-cards-container');
                container.innerHTML = `
                    <div id="maj-card-0" class="maj-card" onclick="voterMajestueux(0)">
                        <h3>Avancer de 10 cases</h3>
                        <p>Propulse le pion de 10 cases en avant (ignorant les pièges)</p>
                    </div>
                    <div id="maj-card-1" class="maj-card" onclick="voterMajestueux(1)">
                        <h3>Punir un adversaire</h3>
                        <p>Élimine 10% des joueurs d'une équipe adverse au choix</p>
                    </div>
                `;
                document.getElementById('maj-vote-status').innerText = 'Touchez une option pour voter...';
                document.getElementById('ecran-cliquable').style.display = 'none';
                document.getElementById('majestueux-vote-screen').style.display = 'flex';
            }
        } else if (data.startsWith('MAJESTUEUX_EVENT_2:')) {
            if (myTeamIndex === tourActuel) {
                majestueuxAVote = false;
                document.getElementById('maj-title').innerText = '🎯 CHOISISSEZ LA CIBLE 🎯';
                const container = document.getElementById('maj-cards-container');
                container.innerHTML = ''; 
                
                const parts = data.split(':');
                if (parts.length > 1) {
                    const teams = parts[1].split('|');
                    teams.forEach(t => {
                        const [idx, name] = t.split('=');
                        if (idx && name) {
                            container.innerHTML += `
                                <div id="maj-card-${idx}" class="maj-card" onclick="voterMajestueux(${idx})">
                                    <h3>Cibler ${name}</h3>
                                    <p>Élimine 10% de leurs membres</p>
                                </div>
                            `;
                        }
                    });
                }
                document.getElementById('maj-vote-status').innerText = 'Sélectionnez l\'équipe à punir...';
            }
        } else if (data.startsWith('MAJESTUEUX_RESULT:')) {
            const gagnant = parseInt(data.split(':')[1]);
            document.querySelectorAll('.maj-card').forEach(c => {
                if (c.id === 'maj-card-' + gagnant) c.classList.add('winner');
                else c.classList.add('loser');
            });
            document.getElementById('maj-vote-status').innerText = 'Choix verrouillé...';
            
        } else if (data === 'MAJESTUEUX_END') {
            document.getElementById('majestueux-vote-screen').style.display = 'none';
            document.getElementById('ecran-cliquable').style.display = '';

        } else if (data.startsWith('ELIMINE:')) {
            const victim = data.split(':')[1];
            const myPseudo = sessionStorage.getItem('dookeyPseudo');
            if (victim === myPseudo) {
                document.getElementById('eliminated-screen').style.display = 'flex';
                document.getElementById('boss-vote-screen').style.display = 'none';
                document.getElementById('ecran-cliquable').style.display = 'none';
            }
        } else if (data.startsWith("NOUVEAU_TOUR:")) {
            let parts = data.split(":");
            tourActuel = parseInt(parts[1]);
            nomEquipeTour = parts[2];
            aVoteCeTour = false;
            document.getElementById('ws-label').innerText = "Tour en cours";
            document.getElementById('team-banner').style.display = 'none';
        } else if (data === 'MON_TOUR') {
            if (qteActive) return; 
            estVerrouille = false;
            estArrete = false;
            aVoteCeTour = false;
            document.getElementById('ws-label').innerText = "C'est ton tour !";
            document.getElementById("ecran-cliquable").style.opacity = "1.0";
            document.getElementById("txt-info").innerText = "À TOI DE JOUER ! CLIQUE POUR ARRÊTER";
            document.getElementById("nom-equipe-tour").innerText = "🎯 TON ÉQUIPE JOUE !";
            melangerChiffres();
            lastTimeMain = performance.now();
            animer(lastTimeMain);
        } else if (data === 'PAS_MON_TOUR') {
            if (qteActive) return; 
            estVerrouille = true;
            estArrete = true;
            document.getElementById("ecran-cliquable").style.opacity = "0.3";
            document.getElementById("txt-info").innerText = "Ce n'est pas le tour de ton équipe...";
            document.getElementById("nom-equipe-tour").innerText = "Héros Actif : " + nomEquipeTour;
            document.getElementById('ws-label').innerText = "En attente...";
        } else if (data === "TEMPS_ECOULE") {
            estVerrouille = true;
            document.getElementById("ecran-cliquable").style.opacity = "0.4";
            document.getElementById("txt-info").innerText = "TEMPS ÉCOULÉ - CHOIX ALÉATOIRE DANS LE JEU...";
            estArrete = true;
        } else if (data === "LOBBY_ATTENTE") {
             aVoteCeTour = false;
             tourActuel = -1;
             nomEquipeTour = "";
             evaluerVerrouillageBase();
        } else if (data.startsWith("VOTRE_EQUIPE:")) {
            const idx = parseInt(data.split(":")[1]);
            myTeamIndex = idx;
            afficherBadgeEquipe(idx);
            const banner = document.getElementById('team-banner');
            banner.style.background = EQUIPES_COULEURS[idx] || '#555';
            banner.innerText = EQUIPES_NOMS[idx] || ('Equipe ' + (idx + 1));
            banner.style.display = 'block';
        } else if (data.startsWith("GAME_WIN:")) {
            const winName = data.split(":")[1];
            document.getElementById('victoire-screen').style.display = 'flex';
            document.getElementById('gagnant-nom').innerText = winName;
            // Retour au menu (reload) après 10s
            setTimeout(() => {
                location.reload();
            }, 10000);
        }
    };
}

function evaluerVerrouillageBase() {
     document.getElementById("nom-equipe-tour").innerText = "En attente du jeu...";
     document.getElementById("txt-info").innerText = "Regardez l'écran principal";
     estVerrouille = true;
     document.getElementById("ecran-cliquable").style.opacity = "0.4";
}

function evaluerVerrouillage() {
    const txtTitre = document.getElementById("nom-equipe-tour");
    txtTitre.innerText = "Héros Actif : " + nomEquipeTour;
    
    if (aVoteCeTour) {
        estVerrouille = true;
        document.getElementById("ecran-cliquable").style.opacity = "0.4";
        document.getElementById("txt-info").innerText = "VOTRE VOTE EST ENREGISTRÉ";
        estArrete = true;
    } else {
        estVerrouille = false;
        document.getElementById("ecran-cliquable").style.opacity = "1.0";
        document.getElementById("txt-info").innerText = "À TOI DE JOUER ! CLIQUE POUR ARRÊTER";
        estArrete = false;
        melangerChiffres();
        lastTimeMain = performance.now();
        animer(lastTimeMain);
    }
}

function melangerChiffres() {
    let chiffres = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
    cases.forEach((elementCase, index) => {
        elementCase.innerText = chiffres[index];
    });
}

function animer(currentTime) {
    if (estArrete) {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        return;
    }

    const deltaTime = (currentTime - lastTimeMain) / 1000; // Convertir en secondes
    lastTimeMain = currentTime;

    position += VITESSE_UNIFORME * direction * deltaTime;
    
    if (position >= 100) { position = 100; direction = -1; }
    else if (position <= 0) { position = 0; direction = 1; }
    
    curseur.style.left = position + "%";

    let index = Math.min(Math.floor(position / (100 / 6)), 5);
    cases.forEach((c, i) => {
        if (i === index) c.classList.add('case-active');
        else c.classList.remove('case-active');
    });

    animFrameId = requestAnimationFrame(animer);
}

document.getElementById('ecran-cliquable').onclick = () => {
    if (estVerrouille || !isGameScreenActive) return;

    if (!estArrete && socket.readyState === WebSocket.OPEN) {
        estArrete = true;
        estVerrouille = true;
        
        let indexArret = Math.min(Math.floor(position / (100 / 6)), 5);
        let scoreObtenu = cases[indexArret].innerText;
        
        socket.send("CLIC:" + scoreObtenu);
        aVoteCeTour = true;
        
        document.body.style.backgroundColor = "#4caf50"; 
        evaluerVerrouillage();
        
        setTimeout(() => { 
            document.body.style.transition = "background-color 0.5s";
            document.body.style.backgroundColor = "#1a1a1a";
            setTimeout(() => document.body.style.transition = "none", 500);
        }, 150);
    }
};

function voterBoss(option) {
    if (bossAVote) return;
    const myPseudo = sessionStorage.getItem('dookeyPseudo');
    if (!myPseudo) return;
    
    // Le serveur Godot vérifiera de toute façon si le pseudo a le droit
    bossAVote = true;
    document.getElementById('boss-card-' + option).classList.add('voted');
    socket.send(`BOSS_VOTE:${option}:${myPseudo}`);
    document.getElementById('boss-vote-status').innerText = "Attente des résultats...";
}

// Voter Majestueux
let majestueuxAVote = false;
function voterMajestueux(option) {
    if (majestueuxAVote) return;
    const myPseudo = sessionStorage.getItem('dookeyPseudo');
    if (!myPseudo) return;
    
    majestueuxAVote = true;
    const card = document.getElementById('maj-card-' + option);
    if (card) card.classList.add('voted');
    
    socket.send(`MAJESTUEUX_VOTE:${option}:${myPseudo}`);
    document.getElementById('maj-vote-status').innerText = "Attente des résultats...";
}

function lancerPortailQTE() {
    qteActive = true;
    portailAClike = false;
    qtePosition = Math.random() * 100;
    document.getElementById('portail-screen').style.display = 'flex';
    document.getElementById('portail-status').innerText = "À VOUS !";
    document.getElementById('portail-status').style.color = "white";
    document.getElementById('portail-flash').style.opacity = "0";
    document.getElementById('ecran-cliquable').style.display = 'none';
    
    // Timer visuel
    let timeLeft = 8;
    const timerElem = document.getElementById('portail-timer');
    timerElem.innerText = timeLeft;
    if (portailInterval) clearInterval(portailInterval);
    portailInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft >= 0) timerElem.innerText = timeLeft;
        if (timeLeft <= 0) clearInterval(portailInterval);
    }, 1000);

    lastTimeQte = performance.now();
    animerPortail(lastTimeQte);
}

function stopPortailQTE() {
    qteActive = false;
    if (qteAnimId) cancelAnimationFrame(qteAnimId);
    if (portailInterval) clearInterval(portailInterval);
    document.getElementById('portail-screen').style.display = 'none';
    document.getElementById('ecran-cliquable').style.display = '';
}

function animerPortail(currentTime) {
    if (!qteActive || portailAClike) return;

    const deltaTime = (currentTime - lastTimeQte) / 1000;
    lastTimeQte = currentTime;

    qtePosition += VITESSE_UNIFORME * qteDirection * deltaTime;
    
    if (qtePosition >= 100) { qtePosition = 100; qteDirection = -1; }
    else if (qtePosition <= 0) { qtePosition = 0; qteDirection = 1; }

    document.getElementById('qte-cursor').style.left = qtePosition + "%";
    qteAnimId = requestAnimationFrame(animerPortail);
}

document.getElementById('portail-screen').onclick = () => {
    if (!qteActive || portailAClike) return;
    
    portailAClike = true;
    
    // Vérifier collision
    const cursor = document.getElementById('qte-cursor');
    const safeZone = document.getElementById('qte-safe-zone');
    const container = document.getElementById('qte-container');
    
    const cursorRect = cursor.getBoundingClientRect();
    const safeRect = safeZone.getBoundingClientRect();
    
    // On vérifie si le centre du curseur est dans la zone
    const cursorCenter = cursorRect.left + cursorRect.width / 2;
    const isSuccess = (cursorCenter >= safeRect.left && cursorCenter <= safeRect.right);
    
    const flash = document.getElementById('portail-flash');
    const status = document.getElementById('portail-status');
    
    if (isSuccess) {
        status.innerText = "RÉUSSI !";
        status.style.color = "#2ecc71"; // Green
        flash.style.background = "rgba(46, 204, 113, 0.4)";
        socket.send("PORTAIL_QTE_VOTE:1");
    } else {
        status.innerText = "ÉCHEC...";
        status.style.color = "#e74c3c"; // Red
        flash.style.background = "rgba(231, 76, 60, 0.4)";
        socket.send("PORTAIL_QTE_VOTE:0");
    }
    
    flash.style.opacity = "1";
    setTimeout(() => { flash.style.opacity = "0"; }, 300);
};