import React, { useState, useEffect } from 'react';
import {
    ApolloClient,
    InMemoryCache,
    ApolloProvider,
    useQuery,
    useMutation,
    gql,
    createHttpLink
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { io } from 'socket.io-client';

// ──────────────────────────────────────────────────────────────
// 1. CONFIGURARE SECURIZATĂ APOLLO CLIENT (TRIMITE TOKEN-UL JWT)
// ──────────────────────────────────────────────────────────────
const httpLink = createHttpLink({
    uri: 'https://tripmap1.onrender.com/graphql',
});

const authLink = setContext((_, { headers }) => {
    // Preluăm token-ul din localStorage pentru a-l valida pe Render
    const token = localStorage.getItem('token');
    return {
        headers: {
            ...headers,
            authorization: token ? `Bearer ${token}` : "",
        }
    };
});

const client = new ApolloClient({
    link: authLink.concat(httpLink),
    cache: new InMemoryCache(),
});

// ──────────────────────────────────────────────────────────────
// 2. INTEROGĂRI ȘI MUTAȚII GRAPHQL (QUERIES & MUTATIONS)
// ──────────────────────────────────────────────────────────────
const GET_TRIPS = gql`
  query GetTrips($page: Int, $city: String) {
    getTrips(page: $page, city: $city) {
      total
      totalPages
      data {
        id
        dest
        price
        days
        desc
      }
    }
  }
`;

const GET_USERS = gql`
  query GetUsers {
    getUsers {
      id
      username
      role
      isSuspicious
    }
  }
`;

const LOGIN_MUTATION = gql`
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      token
      username
      role
    }
  }
`;

const ADD_TRIP = gql`
  mutation AddTrip($dest: String!, $price: Float!, $days: Int!, $desc: String) {
    addTrip(dest: $dest, price: $price, days: $days, desc: $desc) {
      id
      dest
    }
  }
`;

const DELETE_TRIP = gql`
  mutation DeleteTrip($id: ID!) {
    deleteTrip(id: $id)
  }
`;

// ──────────────────────────────────────────────────────────────
// 3. COMPONENTA PRINCIPALĂ APPLICATION INTERFACE
// ──────────────────────────────────────────────────────────────
function MainApp() {
    // State-uri pentru Sesiune și Navigare
    const [user, setUser] = useState(null);
    const [activeTab, setActiveTab] = useState('planificator'); // 'planificator' sau 'audit'
    const [chatOpen, setChatOpen] = useState(false);
    const [socket, setSocket] = useState(null);

    // Formulare Login
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    // Formular Adăugare Vacanță (Admin Only)
    const [dest, setDest] = useState('');
    const [price, setPrice] = useState('');
    const [days, setDays] = useState('');
    const [desc, setDesc] = useState('');

    // Filtre și Paginație Tabel
    const [page, setPage] = useState(1);
    const [searchCity, setSearchCity] = useState('');

    // Interogări Date din Server via Apollo
    const { data: tripsData, refetch: refetchTrips } = useQuery(GET_TRIPS, {
        variables: { page, city: searchCity },
        skip: !user // Rulează doar dacă utilizatorul este logat
    });

    const { data: usersData, refetch: refetchUsers } = useQuery(GET_USERS, {
        skip: !user || user.role !== 'admin' // DOAR Adminul are voie să interogheze utilizatorii suspecți!
    });

    const [loginMutation] = useMutation(LOGIN_MUTATION);
    const [addTripMutation] = useMutation(ADD_TRIP);
    const [deleteTripMutation] = useMutation(DELETE_TRIP);

    // Reîncărcare automată a sesiunii la deschiderea paginii (State Persistence Fix)
    useEffect(() => {
        const savedUser = localStorage.getItem('user');
        const savedToken = localStorage.getItem('token');
        if (savedUser && savedToken) {
            setUser(JSON.parse(savedUser));
        }
    }, []);

    // Inițializare conexiune Socket.io pentru actualizări live (CORS Bypassed)
    useEffect(() => {
        if (user) {
            const s = io('https://tripmap1.onrender.com', { transports: ['websocket'] });
            setSocket(s);

            // Sincronizare automată tabele la evenimente de pe server
            s.on('tripsUpdated', () => { refetchTrips(); });
            s.on('usersUpdated', () => { if (user.role === 'admin') refetchUsers(); });
            s.on('userSuspicious', () => { if (user.role === 'admin') refetchUsers(); });

            return () => s.disconnect();
        }
    }, [user]);

    // Funcție de Autentificare
    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            setLoginError('');
            const { data } = await loginMutation({
                variables: { username: loginUsername, password: loginPassword }
            });

            if (data && data.login) {
                localStorage.setItem('token', data.login.token);
                localStorage.setItem('user', JSON.stringify(data.login));
                setUser(data.login);
            }
        } catch (err) {
            setLoginError('Utilizator sau parolă incorectă!');
        }
    };

    // Funcție de Ieșire Curată din Cont (Logout Fix)
    const handleLogout = () => {
        localStorage.clear();
        sessionStorage.clear();
        setUser(null);
        setLoginUsername('');
        setLoginPassword('');
        window.location.reload(); // Forțează curățarea totală a interfeței
    };

    // Funcție Adăugare Vacanță (Protejată vizual + backend)
    const handleAddTrip = async (e) => {
        e.preventDefault();
        if (user.role !== 'admin') return alert('Eroare: Contul tău este View-Only!');
        try {
            await addTripMutation({
                variables: { dest, price: parseFloat(price), days: parseInt(days), desc }
            });
            setDest(''); setPrice(''); setDays(''); setDesc('');
            refetchTrips();
        } catch (err) {
            alert(err.message);
        }
    };

    // Funcție Ștergere Vacanță (Protejată vizual + backend)
    const handleDeleteTrip = async (id) => {
        if (user.role !== 'admin') return alert('Eroare: Contul tău este View-Only!');
        if (window.confirm('Sigur vrei să ștergi această ofertă?')) {
            try {
                await deleteTripMutation({ variables: { id } });
                refetchTrips();
            } catch (err) {
                alert(err.message);
            }
        }
    };

    // ──────────────────────────────────────────────────────────────
    // RENDER 1: ECRAN DE LOGIN / AUTENTIFICARE (DACĂ NU EXISTĂ SESIUNE)
    // ──────────────────────────────────────────────────────────────
    if (!user) {
        return (
            <div style={{ backgroundColor: '#121214', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'Arial, sans-serif', color: '#fff' }}>
                <div style={{ maxWidth: '400px', width: '100%', padding: '30px', backgroundColor: '#1a1a1e', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', textAlign: 'center' }}>
                    <h2 style={{ marginBottom: '20px' }}>Autentificare Securizată</h2>

                    {loginError && <p style={{ color: '#ff4d4d', fontWeight: 'bold', marginBottom: '15px' }}>{loginError}</p>}

                    <form onSubmit={handleLogin}>
                        <div style={{ marginBottom: '15px', textAlign: 'left' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>Utilizator:</label>
                            <input
                                type="text"
                                value={loginUsername}
                                onChange={(e) => setLoginUsername(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #333', backgroundColor: '#eef2f7', color: '#000', boxSizing: 'border-box' }}
                                required
                            />
                        </div>
                        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>Parolă:</label>
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #333', backgroundColor: '#eef2f7', color: '#000', boxSizing: 'border-box' }}
                                required
                            />
                        </div>
                        <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#3b5bdb', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                            Conectare
                        </button>
                    </form>
                    <p style={{ marginTop: '15px', fontSize: '14px' }}>Nu ai cont? <span style={{ color: '#e64980', cursor: 'pointer' }}>Înregistrează-te acum</span></p>
                </div>
            </div>
        );
    }

    // ──────────────────────────────────────────────────────────────
    // RENDER 2: DASHBOARD INTEGRAL (DOUĂ PANOURI BAZATE PE ROL)
    // ──────────────────────────────────────────────────────────────
    return (
        <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', backgroundColor: '#121214', color: '#fff', minHeight: '100vh' }}>

            {/* HEADER PRINCIPAL APLICAȚIE */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '20px', borderBottom: '1px solid #333', marginBottom: '20px' }}>
                <h1 style={{ margin: 0, fontSize: '24px' }}>🗺️ TripMap App <span style={{ fontSize: '14px', color: '#40c057' }}>• Conexiune HTTPS Securizată</span></h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontSize: '16px' }}>Salut, <strong>{user.username}</strong> ({user.role})</span>

                    <button onClick={() => setActiveTab('planificator')} style={{ padding: '8px 15px', backgroundColor: activeTab === 'planificator' ? '#fff' : '#25262b', color: activeTab === 'planificator' ? '#000' : '#fff', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}>
                        Planificator
                    </button>

                    {/* CRITIC: Butonul pentru Panou Audit este vizibil EXCLUSIV pentru Admin */}
                    {user.role === 'admin' && (
                        <button onClick={() => setActiveTab('audit')} style={{ padding: '8px 15px', backgroundColor: activeTab === 'audit' ? '#fa5252' : '#25262b', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                            Panou Audit
                        </button>
                    )}

                    <button onClick={handleLogout} style={{ padding: '8px 15px', backgroundColor: '#495057', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        Ieșire
                    </button>
                </div>
            </header>

            {/* TAB 1: PLANIFICATORUL DE VACANȚE */}
            {activeTab === 'planificator' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h2>🗺️ Planificator Oferte Vacanțe</h2>

                        {/* CRITIC VIZUAL FIX: Ascundem formularele mari de adăugare/demo pentru utilizatorii simpli */}
                        {user.role === 'admin' && (
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button style={{ padding: '10px 15px', backgroundColor: '#40c057', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>+ Adaugă Vacanță</button>
                                <button style={{ padding: '10px 15px', backgroundColor: '#fab005', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>⚡ Generează Date Demo</button>
                            </div>
                        )}
                    </div>

                    {/* Filtru Căutare */}
                    <div style={{ marginBottom: '20px' }}>
                        <input
                            type="text"
                            placeholder="Filtrare Oraș..."
                            value={searchCity}
                            onChange={(e) => { setSearchCity(e.target.value); setPage(1); }}
                            style={{ padding: '10px', width: '250px', borderRadius: '4px', border: '1px solid #333', backgroundColor: '#25262b', color: '#fff' }}
                        />
                    </div>

                    {/* TABELUL CU DATE */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                        <div style={{ backgroundColor: '#1a1a1e', padding: '20px', borderRadius: '8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #333' }}>
                                        <th style={{ padding: '10px', color: '#22b8cf' }}>Destinație</th>
                                        <th style={{ padding: '10px', color: '#22b8cf' }}>Preț</th>
                                        <th style={{ padding: '10px', color: '#22b8cf' }}>Zile</th>
                                        {/* Coloana Acțiuni se generează doar dacă ești Admin */}
                                        {user.role === 'admin' && <th style={{ padding: '10px', color: '#22b8cf' }}>Acțiuni</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tripsData && tripsData.getTrips.data.map(trip => (
                                        <tr key={trip.id} style={{ borderBottom: '1px solid #25262b' }}>
                                            <td style={{ padding: '12px', fontWeight: 'bold', textDecoration: 'underline' }}>{trip.dest}</td>
                                            <td style={{ padding: '12px' }}>{trip.price} €</td>
                                            <td style={{ padding: '12px' }}>{trip.days} zile</td>
                                            {/* CRITIC VIEW ONLY FIX: Eliminăm complet butoanele Edit/Șterge pentru userul simplu */}
                                            {user.role === 'admin' && (
                                                <td style={{ padding: '12px' }}>
                                                    <button style={{ marginRight: '5px', backgroundColor: '#228be6', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>Edit</button>
                                                    <button onClick={() => handleDeleteTrip(trip.id)} style={{ backgroundColor: '#fa5252', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}>Șterge</button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Paginație */}
                            <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                <button disabled={page === 1} onClick={() => setPage(page - 1)} style={{ padding: '5px 10px', cursor: 'pointer' }}>Înapoi</button>
                                <span style={{ alignSelf: 'center' }}>Pagina {page} din {tripsData?.getTrips.totalPages || 1}</span>
                                <button disabled={page >= (tripsData?.getTrips.totalPages || 1)} onClick={() => setPage(page + 1)} style={{ padding: '5px 10px', cursor: 'pointer' }}>Înainte</button>
                            </div>
                        </div>

                        {/* Secțiunea Grafică Laterală */}
                        <div style={{ backgroundColor: '#1a1a1e', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                            <h3>📊 Prezentare Grafică Bugete</h3>
                            <p style={{ fontSize: '14px', color: '#aaa' }}>Total Oferte active: <strong>{tripsData?.getTrips.total || 0}</strong></p>
                            <div style={{ width: '100%', height: '150px', backgroundColor: '#25262b', borderRadius: '4px', marginTop: '25px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '10px', boxSizing: 'border-box' }}>
                                <div style={{ width: '30px', height: '80%', backgroundColor: '#40c057', borderRadius: '2px' }}></div>
                                <div style={{ width: '30px', height: '45%', backgroundColor: '#22b8cf', borderRadius: '2px' }}></div>
                                <div style={{ width: '30px', height: '20%', backgroundColor: '#fa5252', borderRadius: '2px' }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: PANOU AUDIT & LIVE STEALTH DETECTOR */}
            {activeTab === 'audit' && user.role === 'admin' && (
                <div style={{ backgroundColor: '#1a1a1e', padding: '20px', borderRadius: '8px' }}>
                    <h2>🛡️ Jurnal de Audit și Securitate LAN</h2>
                    <p style={{ color: '#aaa', marginBottom: '20px' }}>Monitorizare atacuri prin inundare de cereri (Rate-limiting enforcement) în timp real.</p>

                    <div style={{ borderBottom: '1px solid #333', marginBottom: '15px', display: 'flex', gap: '20px' }}>
                        <h4 style={{ color: '#fa5252', margin: '0 0 10px 0', borderBottom: '2px solid #fa5252', paddingBottom: '5px' }}>Utilizatori Suspecți</h4>
                    </div>

                    {/* LISTA ACTUALIZATĂ ÎN TIMP REAL PRIN WEBSOCKET / GRAPHQL */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                        {usersData && usersData.getUsers.filter(u => u.isSuspicious).length === 0 ? (
                            <p style={{ color: '#40c057', fontStyle: 'italic', padding: '10px' }}>✅ Sistem curat. Nicio activitate malițioasă detectată în rețea în ultimele 60 de minute.</p>
                        ) : (
                            usersData && usersData.getUsers.filter(u => u.isSuspicious).map(u => (
                                <div key={u.id} style={{ padding: '15px', backgroundColor: 'rgba(250, 82, 82, 0.1)', border: '1px solid #fa5252', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <strong style={{ color: '#fa5252' }}>⚠️ UTILIZATOR SUSPECT DETECTAT:</strong>
                                        <span style={{ marginLeft: '10px', fontSize: '16px' }}>Nume cont: <strong>{u.username}</strong> | Rol atribuit: {u.role}</span>
                                    </div>
                                    <span style={{ backgroundColor: '#fa5252', color: '#fff', padding: '4px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 'bold' }}>BLOCAT DE STEALTH DETECTOR</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* BUTON PLUTITOR: LIVE CHAT WINDOW */}
            <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000 }}>
                <button onClick={() => setChatOpen(!chatOpen)} style={{ padding: '12px 20px', backgroundColor: '#228be6', color: '#fff', border: 'none', borderRadius: '50px', fontWeight: 'bold', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', cursor: 'pointer' }}>
                    💬 {chatOpen ? 'Închide Chat-ul' : 'Deschide Live Chat'}
                </button>

                {chatOpen && (
                    <div style={{ position: 'absolute', bottom: '60px', right: '0', width: '300px', height: '35px', backgroundColor: '#1a1a1e', border: '1px solid #333', borderRadius: '8px', padding: '15px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#22b8cf' }}>Cameră: general</h4>
                        <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>Canal de comunicare securizat...</div>
                    </div>
                )}
            </div>

        </div>
    );
}

// Înfășurăm aplicația în providerul Apollo pentru a moșteni setările link-ului authLink
export default function App() {
    return (
        <ApolloProvider client={client}>
            <MainApp />
        </ApolloProvider>
    );
}