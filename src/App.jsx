import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

// Ajustare automată a URL-ului pentru lucrul local sau în rețea prin HTTPS
const SERVER = import.meta.env.VITE_SERVER_URL || window.location.origin.replace("5173", "5000").replace("http://", "https://");
const socket = io(SERVER, { secure: true, rejectUnauthorized: false });

const App = () => {
    // --- AUTH STATE WITH TOKEN RETRIEVAL ---
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('tripmap_user');
        return saved ? JSON.parse(saved) : null;
    });
    const [authMode, setAuthMode] = useState('login');
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [loginError, setLoginError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // --- TRIPS STATE ---
    const [view, setView] = useState(() => localStorage.getItem('tripmap_user') ? 'dashboard_main' : 'login');
    const [trips, setTrips] = useState([]);
    const [stats, setStats] = useState(null);
    const [isOnline, setIsOnline] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ dest: '', price: '', days: '', desc: '' });
    const [selectedTrip, setSelectedTrip] = useState(null);
    const [filter, setFilter] = useState({ city: '', minPrice: '', maxPrice: '' });
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const loaderRef = useRef(null);

    // --- CHAT STATE ---
    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatRoom] = useState('general');
    const chatEndRef = useRef(null);

    // --- GOLD CHALLENGE STATE ---
    const [suspiciousUsers, setSuspiciousUsers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [activeAdminTab, setActiveAdminTab] = useState('logs');

    // ─────────────────────────────────────────────
    // 🔏 MANAGEMENTUL INACTIVITĂȚII (LOGOUT AUTOMAT)
    // ─────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;

        const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minute
        let timeoutId;

        const handleLogoutDueToInactivity = () => {
            alert("Ai fost deconectat automat din cauza inactivității prelungite!");
            handleLogout();
        };

        const resetTimer = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(handleLogoutDueToInactivity, INACTIVITY_TIMEOUT);
        };

        window.addEventListener('mousemove', resetTimer);
        window.addEventListener('keypress', resetTimer);
        window.addEventListener('click', resetTimer);
        window.addEventListener('scroll', resetTimer);

        resetTimer();

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            window.removeEventListener('mousemove', resetTimer);
            window.removeEventListener('keypress', resetTimer);
            window.removeEventListener('click', resetTimer);
            window.removeEventListener('scroll', resetTimer);
        };
    }, [user]);

    const handleLogout = () => {
        localStorage.removeItem('tripmap_user');
        localStorage.removeItem('tripmap_token');
        setUser(null);
        setView('login');
    };

    const hasPermission = (perm) => {
        if (user?.role?.includes('admin')) return true;
        return user?.permissions?.includes(perm);
    };

    const gqlFetch = useCallback(async (query) => {
        const token = localStorage.getItem('tripmap_token');
        const res = await fetch(`${SERVER}/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ query }),
        });
        return res.json();
    }, []);

    const fetchGoldAdminData = useCallback(async () => {
        if (!user?.role?.includes('admin')) return;
        try {
            const resSuspicious = await fetch(`${SERVER}/api/admin/suspicious`);
            if (resSuspicious.ok) {
                const dataSuspicious = await resSuspicious.json();
                setSuspiciousUsers(dataSuspicious);
            }
            const resLogs = await fetch(`${SERVER}/api/admin/audit-logs`);
            if (resLogs.ok) {
                const dataLogs = await resLogs.json();
                setAuditLogs(dataLogs);
            }
        } catch (err) {
            console.error('Error fetching metrics:', err);
        }
    }, [user]);

    // --- LOGIN IMPLEMENTATION WITH TOKENS ---
    const handleLogin = async () => {
        setLoginError('');
        setSuccessMessage('');
        try {
            const query = `mutation { login(username: "${loginForm.username}", password: "${loginForm.password}") { id username role permissions token } }`;
            const result = await gqlFetch(query);

            if (result.errors) {
                setLoginError('Utilizator sau parolă incorectă!');
                return;
            }

            const loggedUser = result.data.login;
            localStorage.setItem('tripmap_token', loggedUser.token);
            localStorage.setItem('tripmap_user', JSON.stringify(loggedUser));

            setUser(loggedUser);
            setView('dashboard_main');

            socket.emit('joinRoom', { username: loggedUser.username, room: chatRoom });
        } catch {
            setLoginError('Eroare de conexiune securizată SSL!');
        }
    };

    const handleRegister = async () => {
        setLoginError('');
        setSuccessMessage('');

        if (loginForm.username.trim().length < 3) {
            setLoginError('Numele de utilizator trebuie să aibă minim 3 caractere');
            return;
        }
        if (loginForm.password.length < 4) {
            setLoginError('Parola trebuie să aibă minim 4 caractere');
            return;
        }

        try {
            const res = await fetch(`${SERVER}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: loginForm.username.trim(),
                    password: loginForm.password
                })
            });

            const data = await res.json();
            if (!res.ok) {
                setLoginError(data.error || 'Înregistrarea a eșuat');
                return;
            }

            setSuccessMessage('Cont creat cu succes! Se efectuează autentificarea...');
            setTimeout(() => { handleLogin(); }, 1200);
        } catch {
            setLoginError('Eroare la trimiterea datelor securizate.');
        }
    };

    // --- CHAT FUNCTIONS ---
    const loadChatHistory = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER}/api/chat/${chatRoom}`);
            if (res.ok) {
                const msgs = await res.json();
                setChatMessages(msgs);
            }
        } catch { }
    }, [chatRoom]);

    const sendMessage = () => {
        if (!chatInput.trim() || !user) return;
        const msgPayload = {
            userId: user.id,
            username: user.username,
            role: user.role,
            text: chatInput.trim(),
            room: chatRoom,
        };
        socket.emit('sendMessage', msgPayload);
        setChatInput('');
    };

    useEffect(() => {
        socket.on('chatMessage', (msg) => {
            setChatMessages(prev => [...prev, msg]);
            if (view === 'admin_panel') fetchGoldAdminData();
        });
        return () => { socket.off('chatMessage'); };
    }, [view, fetchGoldAdminData]);

    useEffect(() => {
        if (showChat) {
            loadChatHistory();
            if (user) socket.emit('joinRoom', { username: user.username, room: chatRoom });
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    }, [showChat, loadChatHistory, user, chatRoom]);

    // --- TRIP OPERATIONS ---
    const fetchTrips = useCallback(async (isNextPage = false, targetPageManual = null, filterOverride = null) => {
        const targetPage = targetPageManual || (isNextPage ? page + 1 : page);
        const activeFilter = filterOverride !== null ? filterOverride : filter;
        const cityArg = activeFilter.city ? `, city: "${activeFilter.city}"` : '';
        const minArg = activeFilter.minPrice !== '' ? `, minPrice: ${Number(activeFilter.minPrice)}` : '';
        const maxArg = activeFilter.maxPrice !== '' ? `, maxPrice: ${Number(activeFilter.maxPrice)}` : '';

        try {
            if (isNextPage) setIsLoadingMore(true);
            const result = await gqlFetch(`query { getTrips(page: ${targetPage}${cityArg}${minArg}${maxArg}) { total totalPages data { id dest price days desc } } }`);
            if (result.data) {
                const newData = result.data.getTrips.data;
                setTrips(prev => isNextPage ? [...prev, ...newData] : newData);
                setPage(targetPage);
                setTotalPages(result.data.getTrips.totalPages);
                setIsOnline(true);
            }
        } catch { setIsOnline(false); }
        finally { setIsLoadingMore(false); }
    }, [page, filter, gqlFetch]);

    const fetchStats = useCallback(async () => {
        try {
            const result = await gqlFetch(`query { getStats { avgPrice totalTrips maxPrice } }`);
            if (result.data) setStats(result.data.getStats);
        } catch { }
    }, [gqlFetch]);

    const handleSaveTrip = async (e) => {
        e.preventDefault();
        const mutation = editingId
            ? `mutation { updateTrip(id: "${editingId}", dest: "${formData.dest}", price: ${Number(formData.price)}, days: ${Number(formData.days)}, desc: "${formData.desc}") { id } }`
            : `mutation { addTrip(dest: "${formData.dest}", price: ${Number(formData.price)}, days: ${Number(formData.days)}, desc: "${formData.desc}") { id } }`;

        const res = await gqlFetch(mutation);
        if (!res.errors) {
            setShowModal(false);
            setFormData({ dest: '', price: '', days: '', desc: '' });
            setEditingId(null);
            fetchTrips(false, 1);
            fetchStats();
        }
    };

    const handleDeleteTrip = async (id) => {
        if (!window.confirm("Ștergi această vacanță?")) return;
        const res = await gqlFetch(`mutation { deleteTrip(id: "${id}") }`);
        if (!res.errors) {
            fetchTrips(false, 1);
            fetchStats();
        }
    };

    const generateData = async () => {
        setIsGenerating(true);
        await gqlFetch(`mutation { generateSampleData }`);
        setIsGenerating(false);
        fetchTrips(false, 1);
        fetchStats();
    };

    useEffect(() => {
        if (view === 'trip_planner') { fetchTrips(); fetchStats(); }
        if (view === 'admin_panel') { fetchGoldAdminData(); }
    }, [view, fetchTrips, fetchStats, fetchGoldAdminData]);

    return (
        <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', backgroundColor: '#121214', color: '#fff', minHeight: '100vh' }}>
            {/* HEADER SECURE */}
            <header style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '20px', borderBottom: '1px solid #333' }}>
                <h2>🌍 TripMap App <span style={{ fontSize: '12px', color: '#4caf50' }}>● Conexiune HTTPS Securizată</span></h2>
                {user && (
                    <div>
                        <span style={{ marginRight: '15px' }}>Salut, <strong>{user.username}</strong> ({user.role})</span>
                        <button onClick={() => setView('dashboard_main')} style={{ marginRight: '10px', padding: '5px 10px' }}>Dashboard</button>
                        <button onClick={() => setView('trip_planner')} style={{ marginRight: '10px', padding: '5px 10px' }}>Planificator</button>
                        {user.role === 'admin' && <button onClick={() => setView('admin_panel')} style={{ marginRight: '10px', padding: '5px 10px', backgroundColor: '#d32f2f', color: '#fff' }}>Panou Audit</button>}
                        <button onClick={handleLogout} style={{ padding: '5px 10px', backgroundColor: '#555', color: '#fff' }}>Ieșire</button>
                    </div>
                )}
            </header>

            {/* FEREASTRA DE LOGIN / REGISTER */}
            {view === 'login' && (
                <div style={{ maxWidth: '400px', margin: '80px auto', padding: '30px', backgroundColor: '#1a1a1e', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                    <h3>{authMode === 'login' ? 'Autentificare Securizată' : 'Înregistrare Cont Nou'}</h3>
                    {loginError && <p style={{ color: '#ff5252' }}>{loginError}</p>}
                    {successMessage && <p style={{ color: '#4caf50' }}>{successMessage}</p>}

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Utilizator:</label>
                        <input type="text" value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a30', color: '#fff' }} />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Parolă:</label>
                        <input type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a30', color: '#fff' }} />
                    </div>

                    {authMode === 'login' ? (
                        <>
                            <button onClick={handleLogin} style={{ width: '100%', padding: '10px', backgroundColor: '#3f51b5', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Conectare</button>
                            <p style={{ marginTop: '15px', textAlign: 'center', fontSize: '14px' }}>Nu ai cont? <span onClick={() => setAuthMode('register')} style={{ color: '#ff4081', cursor: 'pointer' }}>Înregistrează-te acum</span></p>
                        </>
                    ) : (
                        <>
                            <button onClick={handleRegister} style={{ width: '100%', padding: '10px', backgroundColor: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Creează cont</button>
                            <p style={{ marginTop: '15px', textAlign: 'center', fontSize: '14px' }}>Ai deja un cont? <span onClick={() => setAuthMode('login')} style={{ color: '#ff4081', cursor: 'pointer' }}>Mergi la conectare</span></p>
                        </>
                    )}
                </div>
            )}

            {/* PANOU PRINCIPAL (DASHBOARD) */}
            {view === 'dashboard_main' && user && (
                <div style={{ marginTop: '30px', textAlign: 'center' }}>
                    <h3>Bine ai revenit în panoul principal securizat</h3>
                    <p style={{ color: '#aaa' }}>Sesiunea ta este activă și protejată prin cheie token de laborator.</p>
                    <button onClick={() => setView('trip_planner')} style={{ padding: '12px 24px', fontSize: '16px', backgroundColor: '#00bcd4', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontWeight: 'bold' }}>Vizualizează Oferte Vacanțe</button>
                </div>
            )}

            {/* PLANIFICATOR COMPLET (TABEL, STATISTICI, GRAFIC) */}
            {view === 'trip_planner' && user && (
                <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3>🗺️ Planificator Oferte Vacanțe</h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => { setEditingId(null); setFormData({ dest: '', price: '', days: '', desc: '' }); setShowModal(true); }} style={{ padding: '8px 16px', backgroundColor: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>➕ Adaugă Vacanță</button>
                            <button onClick={generateData} disabled={isGenerating} style={{ padding: '8px 16px', backgroundColor: '#ff9800', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{isGenerating ? 'Se generează...' : '⚡ Generează Date Demo'}</button>
                        </div>
                    </div>

                    {/* FILTRE CAUTARE */}
                    <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', padding: '15px', backgroundColor: '#1a1a1e', borderRadius: '6px' }}>
                        <input type="text" placeholder="Filtrare Oraș..." value={filter.city} onChange={e => { const f = { ...filter, city: e.target.value }; setFilter(f); fetchTrips(false, 1, f); }} style={{ padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px' }} />
                        <input type="number" placeholder="Preț Minim..." value={filter.minPrice} onChange={e => { const f = { ...filter, minPrice: e.target.value }; setFilter(f); fetchTrips(false, 1, f); }} style={{ padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', width: '120px' }} />
                        <input type="number" placeholder="Preț Maxim..." value={filter.maxPrice} onChange={e => { const f = { ...filter, maxPrice: e.target.value }; setFilter(f); fetchTrips(false, 1, f); }} style={{ padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', width: '120px' }} />
                    </div>

                    {/* STRUCTURĂ: TABEL + GRAFIC */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                        {/* TABEL LISTĂ VACANȚE */}
                        <div style={{ backgroundColor: '#1a1a1e', padding: '20px', borderRadius: '8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #444', color: '#00bcd4' }}>
                                        <th style={{ padding: '10px' }}>Destinație</th>
                                        <th>Preț</th>
                                        <th>Zile</th>
                                        <th>Acțiuni</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trips.map(trip => (
                                        <tr key={trip.id} style={{ borderBottom: '1px solid #333' }}>
                                            <td style={{ padding: '10px' }}>
                                                <span onClick={() => setSelectedTrip(trip)} style={{ color: '#fff', cursor: 'pointer', textDecoration: 'underline' }}>{trip.dest}</span>
                                            </td>
                                            <td>{trip.price} €</td>
                                            <td>{trip.days} zile</td>
                                            <td>
                                                <button onClick={() => { setEditingId(trip.id); setFormData({ dest: trip.dest, price: trip.price, days: trip.days, desc: trip.desc || '' }); setShowModal(true); }} style={{ marginRight: '5px', padding: '3px 8px', backgroundColor: '#2196f3', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Edit</button>
                                                <button onClick={() => handleDeleteTrip(trip.id)} style={{ padding: '3px 8px', backgroundColor: '#f44336', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Șterge</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {page < totalPages && (
                                <button onClick={() => fetchTrips(true)} style={{ marginTop: '15px', padding: '8px 16px', backgroundColor: '#444', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '4px' }}>{isLoadingMore ? 'Se încarcă...' : 'Încarcă mai multe vacanțe'}</button>
                            )}
                        </div>

                        {/* GRAFIC ANALITIC ȘI METRICI */}
                        <div style={{ backgroundColor: '#1a1a1e', padding: '20px', borderRadius: '8px', display: 'flex', flexDirection: 'col', gap: '20px' }}>
                            <h4>📊 Prezentare Grafică Bugete</h4>
                            {stats && (
                                <div style={{ fontSize: '14px', background: '#252529', padding: '10px', borderRadius: '6px' }}>
                                    <p>Total Oferte: <strong>{stats.totalTrips}</strong></p>
                                    <p>Preț Mediu: <strong>{stats.avgPrice?.toFixed(2)} €</strong></p>
                                    <p>Preț Maxim: <strong>{stats.maxPrice} €</strong></p>
                                </div>
                            )}
                            <div style={{ width: '100%', height: '220px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={trips.slice(0, 5)}>
                                        <XAxis dataKey="dest" stroke="#aaa" fontSize={11} />
                                        <YAxis stroke="#aaa" fontSize={11} />
                                        <Tooltip contentStyle={{ backgroundColor: '#222', borderColor: '#444' }} />
                                        <Bar dataKey="price" fill="#4caf50" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL ADĂUGARE / EDITARE VACANȚĂ */}
            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                    <form onSubmit={handleSaveTrip} style={{ backgroundColor: '#1a1a1e', padding: '25px', borderRadius: '8px', width: '400px' }}>
                        <h4>{editingId ? 'Modificare Detalii Vacanță' : 'Adăugare Vacanță Nouă'}</h4>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '13px' }}>Oraș / Destinație:</label>
                            <input type="text" required value={formData.dest} onChange={e => setFormData({ ...formData, dest: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', marginTop: '4px' }} />
                        </div>
                        <div style={{ marginBottom: '12px', display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '13px' }}>Preț (€):</label>
                                <input type="number" required value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', marginTop: '4px' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '13px' }}>Durată (Zile):</label>
                                <input type="number" required value={formData.days} onChange={e => setFormData({ ...formData, days: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', marginTop: '4px' }} />
                            </div>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px' }}>Descriere Suplimentară:</label>
                            <textarea value={formData.desc} onChange={e => setFormData({ ...formData, desc: e.target.value })} style={{ width: '100%', padding: '8px', backgroundColor: '#2a2a30', border: '1px solid #444', color: '#fff', borderRadius: '4px', marginTop: '4px', height: '60px', resize: 'none' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button type="button" onClick={() => setShowModal(false)} style={{ padding: '8px 14px', backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Anulează</button>
                            <button type="submit" style={{ padding: '8px 14px', backgroundColor: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Salvează Modificările</button>
                        </div>
                    </form>
                </div>
            )}

            {/* MODAL VIZUALIZARE DETALII DETALIATE */}
            {selectedTrip && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 101 }}>
                    <div style={{ backgroundColor: '#1a1a1e', padding: '25px', borderRadius: '8px', width: '450px' }}>
                        <h3 style={{ color: '#00bcd4', marginTop: 0 }}>📍 {selectedTrip.dest}</h3>
                        <p style={{ fontSize: '15px' }}>Cost estimativ pachet: <strong>{selectedTrip.price} €</strong></p>
                        <p style={{ fontSize: '15px' }}>Durată sejur stabilită: <strong>{selectedTrip.days} zile</strong></p>
                        <hr style={{ border: '0', borderTop: '1px solid #333', margin: '15px 0' }} />
                        <p style={{ color: '#ccc', fontStyle: 'italic', lineHeight: '1.5' }}>{selectedTrip.desc || 'Nu există descriere suplimentară atașată pentru această destinație.'}</p>
                        <button onClick={() => setSelectedTrip(null)} style={{ marginTop: '15px', width: '100%', padding: '10px', backgroundColor: '#2196f3', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>Închide Detalii</button>
                    </div>
                </div>
            )}

            {/* PANOU DE AUDIT (ADMIN ONLY - GOLD CHALLENGE VISUALS PĂSTRATE) */}
            {view === 'admin_panel' && user?.role === 'admin' && (
                <div style={{ marginTop: '20px', backgroundColor: '#161625', padding: '20px', borderRadius: '8px' }}>
                    <h3>🛡️ Jurnal de Audit și Securitate LAN</h3>
                    <div style={{ borderBottom: '1px solid #333', marginBottom: '15px' }}>
                        <button onClick={() => setActiveAdminTab('logs')} style={{ padding: '10px 20px', backgroundColor: activeAdminTab === 'logs' ? '#333' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer' }}>Istoric Acțiuni Recente</button>
                        <button onClick={() => setActiveAdminTab('suspicious')} style={{ padding: '10px 20px', backgroundColor: activeAdminTab === 'suspicious' ? '#333' : 'transparent', color: '#ff5252', border: 'none', cursor: 'pointer' }}>Utilizatori Suspicioși</button>
                    </div>

                    {activeAdminTab === 'logs' ? (
                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ color: '#ff4d4d', borderBottom: '2px solid #333' }}>
                                        <th style={{ padding: '8px' }}>Utilizator</th>
                                        <th>Rol</th>
                                        <th>Acțiune înregistrată</th>
                                        <th>Timestamp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.map(log => (
                                        <tr key={log.id} style={{ borderBottom: '1px solid #222' }}>
                                            <td style={{ padding: '8px' }}>{log.userId}</td>
                                            <td>{log.role}</td>
                                            <td>{log.action}</td>
                                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <ul>
                            {suspiciousUsers.map(u => (
                                <li key={u.id} style={{ color: '#ff5252', padding: '5px 0' }}>⚠️ Utilizator suspectat de FLOOD: <strong>{u.username}</strong> (Flagged: {new Date(u.updatedAt).toLocaleString()})</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* MULTI-ROOM CHAT WIDGET POPUP INTEGRAT URMATOR CERINTELOR TALE */}
            {user && (
                <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000 }}>
                    {!showChat ? (
                        <button onClick={() => setShowChat(true)} style={{ padding: '12px 24px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '50px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(0,123,255,0.4)' }}>💬 Deschide Live Chat</button>
                    ) : (
                        <div style={{ width: '350px', height: '450px', backgroundColor: '#1a1a1e', border: '1px solid #333', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                            <div style={{ backgroundColor: '#252529', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
                                <h4 style={{ margin: 0, color: '#00bcd4' }}>💬 Cameră: {chatRoom}</h4>
                                <button onClick={() => setShowChat(false)} style={{ background: 'transparent', border: 'none', color: '#ff5252', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                            </div>
                            <div style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {chatMessages.map((msg, idx) => (
                                    <div key={idx} style={{ alignSelf: msg.username === user.username ? 'flex-end' : 'flex-start', background: msg.username === user.username ? '#007bff' : '#2d2d34', padding: '8px 12px', borderRadius: '8px', maxWidth: '80%', fontSize: '14px' }}>
                                        <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '2px' }}>{msg.username} ({msg.role || 'user'})</div>
                                        <div>{msg.text}</div>
                                    </div>
                                ))}
                                <div ref={chatEndRef} />
                            </div>
                            <div style={{ padding: '10px', display: 'flex', gap: '5px', backgroundColor: '#252529', borderTop: '1px solid #333' }}>
                                <input type="text" placeholder="Scrie un mesaj securizat..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} style={{ flex: 1, padding: '8px', backgroundColor: '#121214', border: '1px solid #444', color: '#fff', borderRadius: '4px' }} />
                                <button onClick={sendMessage} style={{ padding: '8px 12px', backgroundColor: '#00bcd4', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>Trimite</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default App;