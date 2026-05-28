import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'https://tripmap1-production.up.railway.app';
const socket = io(SERVER, { transports: ['websocket'] });

let authToken = null;

const App = () => {
    const [user, setUser] = useState(null);
    const [authMode, setAuthMode] = useState('login');
    const [loginForm, setLoginForm] = useState({ username: '', password: '' });
    const [loginError, setLoginError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const [view, setView] = useState('login');
    const [trips, setTrips] = useState([]);
    const [stats, setStats] = useState(null);
    const [isOnline, setIsOnline] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [filter, setFilter] = useState({ city: '', minPrice: '', maxPrice: '' });
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const loaderRef = useRef(null);

    const [showChat, setShowChat] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatRoom] = useState('general');
    const chatEndRef = useRef(null);

    const [suspiciousUsers, setSuspiciousUsers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);

    const sessionTimerRef = useRef(null);

    const handleLogout = useCallback(() => {
        authToken = null;
        setUser(null);
        setView('login');
        setAuthMode('login');
        setTrips([]);
        setStats(null);
        setChatMessages([]);
        if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    }, []);

    const startSessionTimer = useCallback(() => {
        if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = setTimeout(() => {
            alert('Sesiunea a expirat. Te rugam sa te autentifici din nou.');
            handleLogout();
        }, 2 * 60 * 60 * 1000);
    }, [handleLogout]);

    const gqlFetch = useCallback(async (query, variables = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${SERVER}/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
        });
        const data = await res.json();
        if (data.errors && data.errors[0]?.message?.includes('jwt')) {
            handleLogout();
        }
        return data;
    }, [handleLogout]);

    const handleLogin = async () => {
        setLoginError('');
        setSuccessMessage('');
        try {
            const result = await fetch(`${SERVER}/graphql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `
                        mutation Login($username: String!, $password: String!) {
                            login(username: $username, password: $password) {
                                id username role permissions token isSuspicious
                            }
                        }
                    `,
                    variables: { username: loginForm.username, password: loginForm.password },
                }),
            });
            const data = await result.json();
            if (data.errors) { setLoginError('Invalid username or password'); return; }

            const loggedUser = data.data.login;
            authToken = loggedUser.token;
            setUser(loggedUser);
            setView('dashboard_main');
            startSessionTimer();
            socket.emit('joinRoom', { username: loggedUser.username, room: chatRoom });
        } catch {
            setLoginError('Connection error');
        }
    };

    const handleRegister = async () => {
        setLoginError('');
        setSuccessMessage('');
        if (loginForm.username.trim().length < 3) { setLoginError('Username must be at least 3 characters'); return; }
        if (loginForm.password.length < 4) { setLoginError('Password must be at least 4 characters'); return; }

        try {
            const res = await fetch(`${SERVER}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginForm.username.trim(), password: loginForm.password })
            });
            const data = await res.json();
            if (!res.ok) { setLoginError(data.error || 'Registration failed'); return; }

            authToken = data.token;
            setSuccessMessage('Account created! Logging in...');

            setTimeout(() => {
                setUser({ id: data.id, username: data.username, role: data.role, permissions: data.permissions || ['view_trips'] });
                setView('dashboard_main');
                startSessionTimer();
                socket.emit('joinRoom', { username: data.username, room: chatRoom });
            }, 1000);
        } catch {
            setLoginError('Server connection error');
        }
    };

    const loadChatHistory = useCallback(async () => {
        try {
            const res = await fetch(`${SERVER}/api/chat/${chatRoom}`);
            if (res.ok) setChatMessages(await res.json());
        } catch { }
    }, [chatRoom]);

    const sendMessage = () => {
        if (!chatInput.trim() || !user) return;
        socket.emit('sendMessage', {
            username: user.username,
            role: user.role,
            text: chatInput.trim(),
            room: chatRoom,
        });
        setChatInput('');
    };

    useEffect(() => {
        socket.on('chatMessage', (msg) => setChatMessages(prev => [...prev, msg]));
        return () => socket.off('chatMessage');
    }, []);

    useEffect(() => {
        if (showChat) {
            loadChatHistory();
            if (user) socket.emit('joinRoom', { username: user.username, room: chatRoom });
            setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    }, [showChat, loadChatHistory, user, chatRoom]);

    useEffect(() => {
        if (chatMessages.length > 0) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const fetchGoldAdminData = useCallback(async () => {
        if (user?.role !== 'admin') return;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const [suspRes, logsRes] = await Promise.all([
                fetch(`${SERVER}/api/admin/suspicious`, { headers }),
                fetch(`${SERVER}/api/admin/audit-logs`, { headers })
            ]);
            if (suspRes.ok) setSuspiciousUsers(await suspRes.json());
            if (logsRes.ok) setAuditLogs(await logsRes.json());
        } catch { }
    }, [user]);

    const fetchTrips = useCallback(async (isNextPage = false, targetPageManual = null, filterOverride = null) => {
        const targetPage = targetPageManual || (isNextPage ? page + 1 : page);
        const activeFilter = filterOverride !== null ? filterOverride : filter;

        const query = `
            query GetTrips($page: Int, $city: String, $minPrice: Float, $maxPrice: Float) {
                getTrips(page: $page, city: $city, minPrice: $minPrice, maxPrice: $maxPrice) {
                    total totalPages
                    data { id dest price days desc }
                }
            }
        `;
        const variables = {
            page: targetPage,
            city: activeFilter.city || null,
            minPrice: activeFilter.minPrice !== '' ? Number(activeFilter.minPrice) : null,
            maxPrice: activeFilter.maxPrice !== '' ? Number(activeFilter.maxPrice) : null,
        };

        try {
            if (isNextPage) setIsLoadingMore(true);
            const result = await gqlFetch(query, variables);
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

    useEffect(() => {
        const heartbeat = setInterval(async () => {
            try {
                const res = await gqlFetch('{ ping }');
                if (res.data && !isOnline) setIsOnline(true);
            } catch { setIsOnline(false); }
        }, 3000);
        socket.on('tripsUpdated', () => { fetchTrips(false, 1); fetchStats(); });
        if (view === 'trip_planner') { fetchTrips(); fetchStats(); }
        if (view === 'admin_panel') { fetchGoldAdminData(); }
        return () => { clearInterval(heartbeat); socket.off('tripsUpdated'); };
    }, [view, fetchTrips, fetchStats, isOnline, gqlFetch, fetchGoldAdminData]);

    useEffect(() => {
        if (view !== 'trip_planner') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoadingMore && page < totalPages && isOnline) fetchTrips(true);
        }, { threshold: 0.1 });
        if (loaderRef.current) observer.observe(loaderRef.current);
        return () => observer.disconnect();
    }, [isLoadingMore, page, totalPages, isOnline, view, fetchTrips]);

    // VIEW: LOGIN
    if (view === 'login') return (
        <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', padding: '20px', boxSizing: 'border-box' }}>
            <div style={{ background: '#161625', padding: '30px 20px', borderRadius: '12px', border: '1px solid cyan', textAlign: 'center', width: '100%', maxWidth: '360px', boxSizing: 'border-box' }}>
                <h2 style={{ color: 'cyan', marginBottom: '8px' }}>Trip Planner Engine</h2>
                <p style={{ color: '#555', marginBottom: '24px', fontSize: '0.85rem' }}>v4.0 Bronze — Secure Access</p>
                <input value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })} placeholder="Username" style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                <input type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Password" style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                {loginError && <p style={{ color: '#ff4d4d', marginBottom: '10px', fontSize: '0.85rem' }}>{loginError}</p>}
                <button onClick={handleLogin} style={{ width: '100%', padding: '12px', background: 'cyan', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', color: 'black' }}>LOGIN</button>
            </div>
        </div>
    );

    // VIEW: DASHBOARD
    if (view === 'dashboard_main') return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', color: 'white', padding: '20px', boxSizing: 'border-box' }}>
            <style>{`
                .dashboard-cards { display: flex; gap: 20px; width: 100%; max-width: 700px; justify-content: center; }
                .dashboard-card { padding: 30px 20px; background: #161625; border-radius: 20px; cursor: pointer; text-align: center; flex: 1; box-sizing: border-box; transition: transform 0.2s; }
                .card-manager { border: 2px solid cyan; }
                .card-security { border: 2px solid #ff4d4d; background: #25161c !important; }
                @media (max-width: 768px) {
                    .dashboard-cards { flex-direction: column; align-items: center; }
                    .dashboard-card { width: 100%; max-width: 340px; }
                }
            `}</style>
            <p style={{ textAlign: 'center', color: '#aaa', marginBottom: '20px' }}>Logged in as <span style={{ color: 'cyan' }}>{user?.username}</span></p>
            <div className="dashboard-cards">
                <div onClick={() => setView('trip_planner')} className="dashboard-card card-manager">
                    <h2 style={{ color: 'cyan', margin: 0 }}>TRIP MANAGER</h2>
                </div>
                {user?.role === 'admin' && (
                    <div onClick={() => setView('admin_panel')} className="dashboard-card card-security">
                        <h2 style={{ color: '#ff4d4d', margin: 0 }}>SECURITY PANEL</h2>
                    </div>
                )}
            </div>
            <button onClick={handleLogout} style={{ background: '#222', color: '#ff4d4d', border: '1px solid #333', padding: '12px 30px', borderRadius: '4px', cursor: 'pointer', marginTop: '30px' }}>LOGOUT</button>
        </div>
    );

    // VIEW: ADMIN PANEL
    if (view === 'admin_panel') return (
        <div style={{ padding: '20px', background: '#0a0a12', color: 'white', minHeight: '100vh' }}>
            <button onClick={() => setView('dashboard_main')}>BACK</button>
            <p>Security Panel Active.</p>
        </div>
    );

    // VIEW: TRIP PLANNER (MAIN)
    return (
        <div style={{ padding: '15px', background: '#0a0a12', color: 'white', minHeight: '100vh', boxSizing: 'border-box' }}>
            <style>{`
                .planner-nav { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 20px; flex-wrap: wrap; gap: 15px; }
                .planner-stats-grid { display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap; }
                .filter-bar { display: flex; gap: 10px; margin-bottom: 15px; background: #161625; padding: 12px; border-radius: 8px; flex-wrap: wrap; }
                .filter-bar input { flex: 1; min-width: 120px; padding: 8px; background: #0a0a12; border: 1px solid #333; color: white; border-radius: 4px; }
                
                .main-layout { display: flex; gap: 20px; }
                .trips-list-box { flex: 2; background: #161625; padding: 15px; border-radius: 12px; overflow-Y: auto; max-height: 60vh; }
                
                /* FIX GRAFIC: Container cu înălțime explicită pe mobil */
                .chart-container-box { flex: 1; background: #161625; padding: 20px; border-radius: 12px; min-height: 300px; display: flex; flex-direction: column; }
                
                /* FIX CHAT: z-index uriaș și fixare deasupra oricărui element */
                .chat-window { position: fixed; bottom: 20px; right: 20px; width: 320px; height: 420px; background: #161625; border: 2px solid cyan; border-radius: 12px; display: flex; flex-direction: column; z-index: 999999 !important; box-shadow: 0 10px 30px rgba(0,0,0,0.7); }
                
                @media (max-width: 768px) {
                    .main-layout { flex-direction: column; gap: 15px; }
                    .planner-nav { flex-direction: column; text-align: center; }
                    .filter-bar input { width: 100%; flex: none; }
                    .chart-container-box { min-height: 260px; height: 260px; } /* Forțăm înălțimea pe mobil */
                    .chat-window { right: 10px; bottom: 10px; left: 10px; width: auto; height: 70vh; }
                }
            `}</style>

            <div className="planner-nav">
                <h1 style={{ margin: 0, fontSize: '1.6rem' }}>Trip<span style={{ color: 'cyan' }}>Planner</span></h1>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button onClick={() => setShowChat(!showChat)} style={{ background: '#161625', color: 'cyan', border: '1px solid cyan', padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>
                        {showChat ? 'Close Chat ✖' : 'Open Chat 💬'}
                    </button>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 16px', cursor: 'pointer', borderRadius: '4px' }}>BACK</button>
                </div>
            </div>

            {stats && (
                <div className="planner-stats-grid">
                    {[{ label: 'Total Trips', value: stats.totalTrips }, { label: 'Avg Price', value: `$${Math.round(stats.avgPrice)}` }, { label: 'Max Price', value: `$${stats.maxPrice}` }].map(s => (
                        <div key={s.label} style={{ background: '#161625', padding: '10px', borderRadius: '8px', border: '1px solid #333', textAlign: 'center', flex: '1 1 100px' }}>
                            <div style={{ color: 'cyan', fontSize: '1.2rem', fontWeight: 'bold' }}>{s.value}</div>
                            <div style={{ color: '#555', fontSize: '0.75rem' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            )}

            <div className="filter-bar">
                <input value={filter.city} onChange={e => setFilter({ ...filter, city: e.target.value })} placeholder="City..." />
                <button onClick={() => fetchTrips(false, 1, filter)} style={{ padding: '8px 15px', background: 'cyan', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', color: 'black' }}>FILTER</button>
            </div>

            <div className="main-layout">
                <div className="trips-list-box">
                    <h3 style={{ margin: '0 0 15px 0', color: 'cyan' }}>Available Trips</h3>
                    {trips.length === 0 ? <p style={{ color: '#555' }}>No trips found.</p> : trips.map(t => (
                        <div key={t.id} style={{ padding: '12px', background: '#0a0a12', borderRadius: '8px', marginBottom: '10px', border: '1px solid #222' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{t.dest}</b><span style={{ color: '#00ff88' }}>${t.price}</span></div>
                        </div>
                    ))}
                    <div ref={loaderRef} style={{ height: '20px' }}></div>
                </div>

                <div className="chart-container-box">
                    <h3 style={{ margin: '0 0 15px 0', color: 'cyan' }}>Analytics</h3>
                    <div style={{ width: '100%', flex: 1, minHeight: '150px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trips.slice(0, 5)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <XAxis dataKey="dest" stroke="#888" style={{ fontSize: '12px' }} />
                                <YAxis stroke="#888" style={{ fontSize: '12px' }} />
                                <Tooltip contentStyle={{ background: '#161625', border: '1px solid #333' }} />
                                <Bar dataKey="price" fill="cyan" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* LIVE CHAT POPUP */}
            {showChat && (
                <div className="chat-window">
                    <div style={{ background: '#0a0a12', padding: '12px', borderBottom: '1px solid cyan', display: 'flex', justifyContent: 'space-between', borderTopLeftRadius: '10px', borderTopRightRadius: '10px' }}>
                        <b style={{ color: 'cyan' }}>💬 Live Chat</b>
                        <span onClick={() => setShowChat(false)} style={{ cursor: 'pointer', color: '#ff4d4d', fontWeight: 'bold', padding: '0 5px' }}>✖</span>
                    </div>
                    <div style={{ flex: 1, padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', background: '#11111f' }}>
                        {chatMessages.map((msg, idx) => (
                            <div key={idx} style={{ background: msg.username === user?.username ? '#0f2027' : '#232526', padding: '8px 12px', borderRadius: '8px', maxWidth: '85%', alignSelf: msg.username === user?.username ? 'flex-end' : 'flex-start' }}>
                                <div style={{ fontSize: '0.7rem', color: 'cyan', fontWeight: 'bold' }}>{msg.username}</div>
                                <div style={{ fontSize: '0.85rem', marginTop: '2px', color: '#fff' }}>{msg.text}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                    <div style={{ padding: '10px', background: '#0a0a12', display: 'flex', gap: '5px', borderBottomLeftRadius: '10px', borderBottomRightRadius: '10px' }}>
                        <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Type a message..." style={{ flex: 1, padding: '10px', background: '#161625', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                        <button onClick={sendMessage} style={{ background: 'cyan', color: 'black', border: 'none', padding: '10px 15px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Send</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;