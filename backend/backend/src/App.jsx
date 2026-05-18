import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { io } from 'socket.io-client';

// ────────────────────────────────────────────────────────────────────
//  BRONZE REQUIREMENT: Change this to the server machine's IP address
//  when running client on a different machine.
//  Example: const SERVER = 'http://192.168.1.10:5000';
// ────────────────────────────────────────────────────────────────────
const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

const socket = io(SERVER);

const App = () => {
    const [view, setView] = useState('login');
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

    const gqlFetch = useCallback(async (query) => {
        const res = await fetch(`${SERVER}/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        return res.json();
    }, []);

    const fetchTrips = useCallback(async (isNextPage = false, targetPageManual = null) => {
        const targetPage = targetPageManual || (isNextPage ? page + 1 : page);
        const cityArg = filter.city ? `, city: "${filter.city}"` : '';
        const minArg = filter.minPrice ? `, minPrice: ${filter.minPrice}` : '';
        const maxArg = filter.maxPrice ? `, maxPrice: ${filter.maxPrice}` : '';

        const gqlQuery = `query { 
            getTrips(page: ${targetPage}${cityArg}${minArg}${maxArg}) { 
                total totalPages 
                data { id dest price days desc } 
            } 
        }`;

        try {
            if (isNextPage) setIsLoadingMore(true);
            const result = await gqlFetch(gqlQuery);
            if (result.data) {
                const newData = result.data.getTrips.data;
                setTrips(prev => isNextPage ? [...prev, ...newData] : newData);
                setPage(targetPage);
                setTotalPages(result.data.getTrips.totalPages);
                setIsOnline(true);
            }
        } catch {
            setIsOnline(false);
        } finally {
            setIsLoadingMore(false);
        }
    }, [page, filter, gqlFetch]);

    const fetchStats = useCallback(async () => {
        try {
            const result = await gqlFetch(`query { getStats { avgPrice totalTrips maxPrice } }`);
            if (result.data) setStats(result.data.getStats);
        } catch { }
    }, [gqlFetch]);

    const prefetchNextPage = useCallback(() => {
        if (page < totalPages && isOnline) {
            gqlFetch(`query { getTrips(page: ${page + 1}) { data { id } } }`);
        }
    }, [page, totalPages, isOnline, gqlFetch]);

    const syncData = useCallback(async () => {
        const queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
        if (queue.length === 0) return;
        for (const action of queue) {
            try { await gqlFetch(action.gqlMutation); } catch { break; }
        }
        localStorage.removeItem('offline_queue');
        fetchTrips(false, 1);
    }, [fetchTrips, gqlFetch]);

    useEffect(() => {
        const heartbeat = setInterval(async () => {
            try {
                const res = await gqlFetch('{ ping }');
                if (res.data && !isOnline) { setIsOnline(true); syncData(); }
            } catch { setIsOnline(false); }
        }, 3000);

        socket.on('tripsUpdated', () => { fetchTrips(false, 1); fetchStats(); });

        if (view === 'trip_planner') { fetchTrips(); fetchStats(); prefetchNextPage(); }

        return () => { clearInterval(heartbeat); socket.off('tripsUpdated'); };
    }, [view, fetchTrips, fetchStats, syncData, isOnline, prefetchNextPage, gqlFetch]);

    useEffect(() => {
        if (view !== 'trip_planner') return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoadingMore && page < totalPages && isOnline) {
                fetchTrips(true);
            }
        }, { threshold: 0.1 });
        if (loaderRef.current) observer.observe(loaderRef.current);
        return () => observer.disconnect();
    }, [isLoadingMore, page, totalPages, isOnline, view, fetchTrips]);

    const handleAction = async (method, data) => {
        let gqlMutation = '';
        if (method === 'DELETE') {
            gqlMutation = `mutation { deleteTrip(id: "${data.id}") }`;
        } else {
            if (!data.dest || data.price <= 0) return alert('Invalid data! Destination required and price must be > 0.');
            gqlMutation = editingId
                ? `mutation { updateTrip(id: "${editingId}", dest: "${data.dest}", price: ${data.price}, days: ${data.days}, desc: "${data.desc}") { id } }`
                : `mutation { addTrip(dest: "${data.dest}", price: ${data.price}, days: ${data.days}, desc: "${data.desc}") { id } }`;
        }

        if (!isOnline) {
            const queue = JSON.parse(localStorage.getItem('offline_queue') || '[]');
            queue.push({ gqlMutation });
            localStorage.setItem('offline_queue', JSON.stringify(queue));
            alert('Saved offline. Will sync when back online.');
            setShowModal(false);
            return;
        }

        try {
            const result = await gqlFetch(gqlMutation);
            if (result.errors) return alert(result.errors[0].message);
            setShowModal(false);
            fetchTrips(false, 1);
            fetchStats();
        } catch { setIsOnline(false); }
    };

    if (view === 'login') return (
        <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0a0a12' }}>
            <div style={{ background: '#161625', padding: '40px', borderRadius: '12px', border: '1px solid cyan', textAlign: 'center' }}>
                <h2 style={{ color: 'cyan', marginBottom: '8px' }}>Trip Planner Engine</h2>
                <p style={{ color: '#555', marginBottom: '20px', fontSize: '0.85rem' }}>v3.0 – Assignment 3 (Sequelize ORM)</p>
                <button onClick={() => setView('dashboard_main')} style={{ padding: '10px 30px', background: 'cyan', cursor: 'pointer', border: 'none', fontWeight: 'bold', borderRadius: '4px' }}>ENTER SYSTEM</button>
            </div>
        </div>
    );

    if (view === 'dashboard_main') return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#0a0a12', color: 'white', gap: '20px' }}>
            <div onClick={() => setView('trip_planner')} style={{ padding: '60px', background: '#161625', border: '2px solid cyan', borderRadius: '20px', cursor: 'pointer', textAlign: 'center' }}>
                <h2 style={{ color: 'cyan', margin: 0 }}>OPEN MANAGEMENT CONSOLE</h2>
                <p style={{ color: '#555', marginTop: '10px' }}>v3.0 Gold Edition – SQLite Persistence</p>
            </div>
        </div>
    );

    return (
        <div style={{ padding: '20px', background: '#0a0a12', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px' }}>
                <h1 style={{ margin: 0 }}>Trip<span style={{ color: 'cyan' }}>Planner</span></h1>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <div style={{ color: isOnline ? '#00ff88' : '#ff4d4d', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        {isOnline ? '● SERVER ONLINE' : '● CONNECTION LOST'}
                    </div>
                    <button onClick={() => setView('dashboard_main')} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 15px', cursor: 'pointer', borderRadius: '4px' }}>EXIT</button>
                </div>
            </div>

            {stats && (
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                    {[
                        { label: 'Total Trips', value: stats.totalTrips },
                        { label: 'Avg Price', value: `$${Math.round(stats.avgPrice)}` },
                        { label: 'Max Price', value: `$${stats.maxPrice}` },
                    ].map(s => (
                        <div key={s.label} style={{ background: '#161625', padding: '10px 20px', borderRadius: '8px', border: '1px solid #333', textAlign: 'center', flex: 1 }}>
                            <div style={{ color: 'cyan', fontSize: '1.4rem', fontWeight: 'bold' }}>{s.value}</div>
                            <div style={{ color: '#555', fontSize: '0.75rem' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <button onClick={async () => {
                    const action = isGenerating ? 'stop' : 'start';
                    await gqlFetch(`mutation { toggleGenerator(action: "${action}") }`);
                    setIsGenerating(!isGenerating);
                }} style={{ background: isGenerating ? '#ff4d4d' : '#00ff88', border: 'none', padding: '10px 25px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {isGenerating ? '⏹ STOP GENERATOR' : '▶ START LIVE DATA GENERATOR'}
                </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', background: '#161625', padding: '12px', borderRadius: '8px' }}>
                <input value={filter.city} onChange={e => setFilter({ ...filter, city: e.target.value })} placeholder="Filter by city..." style={{ flex: 2, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <input type="number" value={filter.minPrice} onChange={e => setFilter({ ...filter, minPrice: e.target.value })} placeholder="Min price" style={{ flex: 1, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <input type="number" value={filter.maxPrice} onChange={e => setFilter({ ...filter, maxPrice: e.target.value })} placeholder="Max price" style={{ flex: 1, padding: '8px', background: '#0a0a12', border: '1px solid #333', color: 'white', borderRadius: '4px' }} />
                <button onClick={() => fetchTrips(false, 1)} style={{ padding: '8px 20px', background: 'cyan', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>FILTER</button>
                <button onClick={() => { setFilter({ city: '', minPrice: '', maxPrice: '' }); fetchTrips(false, 1); }} style={{ padding: '8px 15px', background: '#333', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>CLEAR</button>
            </div>

            <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 340px)' }}>
                <div style={{ flex: 2, background: '#161625', padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0 }}>Destinations (Page {page}/{totalPages})</h3>
                        <button onClick={() => { setEditingId(null); setFormData({ dest: '', price: '', days: '', desc: '' }); setShowModal(true); }} style={{ background: 'cyan', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>+ NEW TRIP</button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #222' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#1c1c2e', zIndex: 1 }}>
                                <tr style={{ color: 'cyan', textAlign: 'left', borderBottom: '1px solid #333' }}>
                                    <th style={{ padding: '12px' }}>City</th>
                                    <th>Days</th>
                                    <th>Price</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trips.map(t => (
                                    <tr key={t.id} onClick={() => setSelectedTrip(t)} style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: selectedTrip?.id === t.id ? '#1a1a2e' : 'transparent' }}>
                                        <td style={{ padding: '12px' }}>{t.dest}</td>
                                        <td>{t.days}</td>
                                        <td style={{ color: '#00ff88' }}>${t.price}</td>
                                        <td>
                                            <button onClick={e => { e.stopPropagation(); setEditingId(t.id); setFormData(t); setShowModal(true); }} style={{ background: 'none', border: 'none', color: 'orange', cursor: 'pointer', marginRight: '10px' }}>Edit</button>
                                            <button onClick={e => { e.stopPropagation(); if (window.confirm(`Delete trip to ${t.dest}?`)) handleAction('DELETE', { id: t.id }); }} style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer' }}>Del</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div ref={loaderRef} style={{ padding: '15px', textAlign: 'center', color: '#555' }}>
                            {isLoadingMore ? '⏳ Loading more...' : (page >= totalPages ? '— End of list —' : '↓ Scroll for more')}
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', paddingTop: '10px' }}>
                        <button disabled={page === 1} onClick={() => fetchTrips(false, page - 1)} style={{ padding: '5px 10px', background: '#333', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>Prev</button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
                            <button key={i} onClick={() => fetchTrips(false, i + 1)} style={{ padding: '5px 10px', background: page === i + 1 ? 'cyan' : '#333', color: page === i + 1 ? 'black' : 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>{i + 1}</button>
                        ))}
                        <button disabled={page === totalPages} onClick={() => fetchTrips(false, page + 1)} style={{ padding: '5px 10px', background: '#333', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>Next</button>
                    </div>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ background: '#161625', padding: '20px', borderRadius: '12px', height: '180px' }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Cost Overview (last 10)</h4>
                        <ResponsiveContainer width="100%" height="85%">
                            <BarChart data={trips.slice(-10)}>
                                <XAxis dataKey="dest" hide />
                                <YAxis hide />
                                <Tooltip contentStyle={{ background: '#161625', border: '1px solid cyan' }} />
                                <Bar dataKey="price" fill="cyan" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{ background: '#161625', padding: '20px', borderRadius: '12px', border: '1px solid cyan', flex: 1 }}>
                        <h3 style={{ color: 'cyan', marginTop: 0 }}>Trip Details</h3>
                        {selectedTrip ? (
                            <div>
                                <h2 style={{ margin: '10px 0' }}>{selectedTrip.dest}</h2>
                                <p style={{ color: '#aaa', lineHeight: '1.5' }}>{selectedTrip.desc || 'No additional details provided.'}</p>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#00ff88', marginTop: '20px' }}>Price: ${selectedTrip.price}</div>
                                <div style={{ color: '#888' }}>Duration: {selectedTrip.days} days</div>
                            </div>
                        ) : <p style={{ color: '#444' }}>Select a destination to view details.</p>}
                    </div>
                </div>
            </div>

            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
                    <div style={{ background: '#161625', padding: '30px', borderRadius: '12px', width: '400px', border: '1px solid cyan' }}>
                        <h3 style={{ color: 'cyan', marginTop: 0 }}>{editingId ? 'Modify' : 'Create'} Trip Record</h3>
                        <input value={formData.dest} onChange={e => setFormData({ ...formData, dest: e.target.value })} placeholder="Destination City" style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) })} placeholder="Price ($)" style={{ width: '50%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                            <input type="number" value={formData.days} onChange={e => setFormData({ ...formData, days: parseInt(e.target.value) })} placeholder="Days" style={{ width: '50%', padding: '12px', marginBottom: '10px', background: '#0a0a12', border: '1px solid #333', color: 'white', boxSizing: 'border-box', borderRadius: '4px' }} />
                        </div>
                        <textarea value={formData.desc} onChange={e => setFormData({ ...formData, desc: e.target.value })} placeholder="Description..." style={{ width: '100%', padding: '12px', marginBottom: '20px', background: '#0a0a12', border: '1px solid #333', color: 'white', height: '80px', boxSizing: 'border-box', borderRadius: '4px' }} />
                        <button onClick={() => handleAction('SAVE', formData)} style={{ width: '100%', padding: '12px', background: 'cyan', border: 'none', fontWeight: 'bold', cursor: 'pointer', color: 'black', borderRadius: '4px' }}>CONFIRM</button>
                        <button onClick={() => setShowModal(false)} style={{ width: '100%', marginTop: '10px', background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>Discard</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;