'use strict';

require('dotenv').config();

const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const { ApolloServer, gql } = require('apollo-server-express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_tripmap_2026';

// ─────────────────────────────────────────────
// 1.  POSTGRESQL SETUP (Sequelize ORM)
// ─────────────────────────────────────────────
const sequelize = process.env.NODE_ENV === 'production'
    ? new Sequelize(
        process.env.DB_NAME || 'defaultdb',
        process.env.DB_USER || 'avnadmin',
        process.env.DB_PASSWORD,
        {
            dialect: 'postgres',
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 25850,
            dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
            logging: false,
        }
    )
    : new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, '../db/trips.sqlite'),
        logging: false,
    });

// ─────────────────────────────────────────────
// 2.  MONGODB SETUP (Mongoose)
// ─────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dariaabrudan1_db_user:NUkRsTK43VD8dNZi@cluster0.emvcr7r.mongodb.net/tripmap_chat?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected (Chat)'))
    .catch(err => console.error('❌ MongoDB error:', err));

const MessageSchema = new mongoose.Schema({
    username: { type: String, required: true },
    role: { type: String, default: 'user' },
    text: { type: String, required: true },
    room: { type: String, default: 'general' },
    createdAt: { type: Date, default: Date.now },
});

const Message = mongoose.model('Message', MessageSchema);

// ─────────────────────────────────────────────
// 3.  POSTGRESQL MODELS
// ─────────────────────────────────────────────
const Role = sequelize.define('Role', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
}, { tableName: 'roles', timestamps: false });

const Permission = sequelize.define('Permission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
}, { tableName: 'permissions', timestamps: false });

const RolePermission = sequelize.define('RolePermission', {
    roleId: { type: DataTypes.INTEGER, references: { model: 'roles', key: 'id' } },
    permissionId: { type: DataTypes.INTEGER, references: { model: 'permissions', key: 'id' } },
}, { tableName: 'role_permissions', timestamps: false });

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(100), allowNull: false, unique: true, validate: { len: [3, 100] } },
    password: { type: DataTypes.STRING(255), allowNull: false },
    roleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'roles', key: 'id' } },
    isSuspicious: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'users', timestamps: true });

const Destination = sequelize.define('Destination', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    city: { type: DataTypes.STRING(100), allowNull: false, unique: true, validate: { len: [2, 100] } },
    country: { type: DataTypes.STRING(100), allowNull: true },
}, { tableName: 'destinations', timestamps: true });

const Trip = sequelize.define('Trip', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    price: { type: DataTypes.FLOAT, allowNull: false, validate: { min: 0 } },
    days: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
    description: { type: DataTypes.TEXT, allowNull: true },
    destinationId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'destinations', key: 'id' } },
}, { tableName: 'trips', timestamps: true });

const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.TEXT, allowNull: false },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'audit_logs', timestamps: false });

Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', as: 'roles' });
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });
Destination.hasMany(Trip, { foreignKey: 'destinationId', as: 'trips' });
Trip.belongsTo(Destination, { foreignKey: 'destinationId', as: 'destination' });

// Instanțiere timpurie a Serverului Socket.io pentru a fi accesibil în funcția de detecție
let io;

// Funcție pentru monitorizarea acțiunilor suspecte în timp real
async function logAction(userIdentifier, role, actionDescription) {
    try {
        await AuditLog.create({ userId: String(userIdentifier), role: role, action: actionDescription });

        // Dacă acțiunea este făcută de un user normal, verificăm frecvența cererilor
        if (role !== 'admin') {
            const tenSecondsAgo = new Date(Date.now() - 10000);
            const recentActionsCount = await AuditLog.count({
                where: { userId: String(userIdentifier), timestamp: { [Op.gte]: tenSecondsAgo } }
            });

            // Dacă face mai mult de 3 modificări/cereri în 10 secunde, îl marcăm suspect
            if (recentActionsCount > 3) {
                await User.update({ isSuspicious: true }, { where: { username: String(userIdentifier) } });
                console.log(`⚠️ STEALTH DETECTOR: Utilizatorul '${userIdentifier}' a fost marcat ca SUSPICiOS!`);

                // Trimitem alertă instant către frontend prin WebSocket pentru actualizarea panoului
                if (io) {
                    io.emit('userSuspicious', { username: userIdentifier, isSuspicious: true });
                    io.emit('usersUpdated');
                }
            }
        }
    } catch (err) { console.error('Eroare adăugare jurnal audit:', err); }
}

// Helper funcție de decodare și validare token JWT pentru protecția rutei GraphQL
function getUserFromToken(authHeader) {
    if (!authHeader) return null;
    try {
        const token = authHeader.replace('Bearer ', '');
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// ─────────────────────────────────────────────
// 4.  DATABASE MIGRATION & BULK SEED
// ─────────────────────────────────────────────
async function migrate() {
    await sequelize.authenticate();
    await sequelize.sync({ force: false });

    const [adminRole] = await Role.findOrCreate({ where: { name: 'admin' } });
    const [userRole] = await Role.findOrCreate({ where: { name: 'user' } });

    const permNames = ['create_trip', 'edit_trip', 'delete_trip', 'view_trips', 'manage_users'];
    const perms = {};
    for (const name of permNames) {
        const [p] = await Permission.findOrCreate({ where: { name } });
        perms[name] = p;
    }

    await adminRole.setPermissions(Object.values(perms));
    await userRole.setPermissions([perms['view_trips']]);

    // Resincronizăm conturile standard la fiecare pornire curată
    await User.destroy({ where: { username: 'admin' } });
    await User.destroy({ where: { username: 'user1' } });

    const hashedAdminPassword = await bcrypt.hash('admin123', 10);
    const hashedUserPassword = await bcrypt.hash('user123', 10);

    await User.create({ username: 'admin', password: hashedAdminPassword, roleId: adminRole.id });
    await User.create({ username: 'user1', password: hashedUserPassword, roleId: userRole.id });

    const tripCount = await Trip.count();
    if (tripCount === 0) {
        const paris = await Destination.create({ city: 'Paris', country: 'France' });
        const tokyo = await Destination.create({ city: 'Tokyo', country: 'Japan' });
        await Trip.create({ price: 2500, days: 5, description: 'Orașul Luminilor.', destinationId: paris.id });
        await Trip.create({ price: 3800, days: 10, description: 'Tradiție și tehnologie.', destinationId: tokyo.id });
    }

    console.log('✅ Baza de date Postgres sincronizată: Modulul Admin și Politicile View-Only sunt active.');
}

const toGql = (trip) => ({
    id: String(trip.id),
    dest: trip.destination ? trip.destination.city : '',
    price: trip.price,
    days: trip.days,
    desc: trip.description || '',
});

const include = [{ model: Destination, as: 'destination' }];

// ─────────────────────────────────────────────
// 5.  EXPRESS & GLOBAL CORS CONFIGURATION
// ─────────────────────────────────────────────
const app = express();

const corsOptions = {
    origin: function (origin, callback) {
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};

app.use(cors(corsOptions));
app.use(express.json());

// REST - Endpoints
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Sunt necesare utilizatorul și parola' });

        const user = await User.findOne({
            where: { username: username.trim() },
            include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
        });

        if (!user) return res.status(401).json({ error: 'Date de autentificare invalide' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Date de autentificare invalide' });

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role.name, permissions: user.role.permissions.map(p => p.name) },
            JWT_SECRET, { expiresIn: '2h' }
        );

        await logAction(user.username, user.role.name, `Utilizatorul s-a conectat la platformă`);

        res.json({
            token,
            id: user.id,
            username: user.username,
            role: user.role.name,
            permissions: user.role.permissions.map(p => p.name)
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const userRole = await Role.findOne({ where: { name: 'user' } });
        const newUser = await User.create({ username: username.trim(), password: hashedPassword, roleId: userRole.id });
        res.json({ id: newUser.id, username: newUser.username, role: 'user' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/trips', async (req, res) => {
    const trips = await Trip.findAll({ include });
    res.json(trips.map(toGql));
});

// ─────────────────────────────────────────────
// 6.  SERVER INSTANTIATION
// ─────────────────────────────────────────────
let server = http.createServer(app);

io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true }
});

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ username, room }) => { socket.join(room); });
    socket.on('sendMessage', async ({ username, role, text, room }) => {
        const msg = new Message({ username, role, text, room });
        await msg.save();
        io.to(room).emit('chatMessage', { username, role, text, createdAt: msg.createdAt });
    });
});

// ─────────────────────────────────────────────
// 7.  GRAPHQL SCHEMA & RESOLVERS WITH ROLE VALIDATION
// ─────────────────────────────────────────────
const typeDefs = gql`
  type Trip { id: ID! dest: String! price: Float! days: Int! desc: String }
  type Stats { avgPrice: Float! totalTrips: Int! maxPrice: Float! }
  type PaginatedTrips { total: Int! data: [Trip]! totalPages: Int! }
  type UserInfo { id: ID! username: String! role: String! permissions: [String]! isSuspicious: Boolean, token: String }
  type Query { getTrips(page: Int, city: String, minPrice: Float, maxPrice: Float): PaginatedTrips \n getStats: Stats \n ping: String \n getUsers: [UserInfo] }
  type Mutation { addTrip(dest: String!, price: Float!, days: Int!, desc: String): Trip \n updateTrip(id: ID!, dest: String!, price: Float!, days: Int!, desc: String): Trip \n deleteTrip(id: ID!): Boolean \n toggleGenerator(action: String!): String \n login(username: String!, password: String!): UserInfo }
`;

const resolvers = {
    Query: {
        getTrips: async (_, { page = 1, city, minPrice, maxPrice }, { user }) => {
            if (user) await logAction(user.username, user.role, `A interogat lista de călătorii (Pagina ${page})`);
            const LIMIT = 5; const offset = (page - 1) * LIMIT; const tripWhere = {};
            if (minPrice != null && minPrice !== '') tripWhere.price = { ...tripWhere.price, [Op.gte]: Number(minPrice) };
            if (maxPrice != null && maxPrice !== '') tripWhere.price = { ...tripWhere.price, [Op.lte]: Number(maxPrice) };
            const destInclude = { model: Destination, as: 'destination', required: city ? true : false, ...(city ? { where: { city: { [Op.like]: `%${city}%` } } } : {}) };
            const { count, rows } = await Trip.findAndCountAll({ where: tripWhere, include: [destInclude], limit: LIMIT, offset, order: [['createdAt', 'DESC']], distinct: true });
            return { total: count, totalPages: Math.ceil(count / LIMIT) || 1, data: rows.map(toGql) };
        },
        getStats: async () => {
            const total = await Trip.count();
            const result = await Trip.findOne({ attributes: [[sequelize.fn('AVG', sequelize.col('price')), 'avgPrice'], [sequelize.fn('MAX', sequelize.col('price')), 'maxPrice']], raw: true });
            return { avgPrice: parseFloat(result?.avgPrice) || 0, maxPrice: parseFloat(result?.maxPrice) || 0, totalTrips: total };
        },
        ping: () => 'pong',
        getUsers: async (_, __, { user }) => {
            // Doar adminul poate interoga panoul de utilizatori suspecți
            if (!user || user.role !== 'admin') {
                throw new Error('Acces neautorizat. Doar administratorii pot vedea acest panou.');
            }
            const users = await User.findAll({ include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }] });
            return users.map(u => ({ id: String(u.id), username: u.username, role: u.role.name, permissions: u.role.permissions.map(p => p.name), isSuspicious: u.isSuspicious }));
        }
    },
    Mutation: {
        login: async (_, { username, password }) => {
            const user = await User.findOne({ where: { username: username.trim() }, include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }] });
            if (!user) throw new Error('Date de autentificare invalide');
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) throw new Error('Date de autentificare invalide');
            const token = jwt.sign({ id: user.id, username: user.username, role: user.role.name }, JWT_SECRET, { expiresIn: '2h' });
            return { id: String(user.id), username: user.username, role: user.role.name, permissions: user.role.permissions.map(p => p.name), isSuspicious: user.isSuspicious, token };
        },
        addTrip: async (_, { dest, price, days, desc }, { user }) => {
            // VERIFICARE CRITICĂ: View Only pentru non-admini
            if (!user || user.role !== 'admin') {
                if (user) await logAction(user.username, user.role, `⚠️ TENTATIVĂ BLOCATĂ: Adăugare destinație fără drepturi`);
                throw new Error('Permisiune refuzată: Contul tău este View-Only!');
            }

            const [destination] = await Destination.findOrCreate({ where: { city: dest.trim() } });
            const trip = await Trip.create({ price: Number(price), days: Number(days), description: desc || '', destinationId: destination.id });

            await logAction(user.username, user.role, `A adăugat o nouă călătorie către ${dest}`);
            io.emit('tripsUpdated');
            return toGql({ ...trip.toJSON(), destination });
        },
        updateTrip: async (_, { id, dest, price, days, desc }, { user }) => {
            // VERIFICARE CRITICĂ: View Only pentru non-admini
            if (!user || user.role !== 'admin') {
                if (user) await logAction(user.username, user.role, `⚠️ TENTATIVĂ BLOCATĂ: Modificare destinație fără drepturi`);
                throw new Error('Permisiune refuzată: Contul tău este View-Only!');
            }

            const trip = await Trip.findByPk(id, { include }); if (!trip) throw new Error('Călătoria nu a fost găsită');
            const [destination] = await Destination.findOrCreate({ where: { city: dest.trim() } });
            await trip.update({ price: Number(price), days: Number(days), description: desc || '', destinationId: destination.id });

            await logAction(user.username, user.role, `A modificat călătoria ID ${id}`);
            io.emit('tripsUpdated');
            return toGql(trip);
        },
        deleteTrip: async (_, { id }, { user }) => {
            // VERIFICARE CRITICĂ: View Only pentru non-admini
            if (!user || user.role !== 'admin') {
                if (user) await logAction(user.username, user.role, `⚠️ TENTATIVĂ BLOCATĂ: Ștergere destinație fără drepturi`);
                throw new Error('Permisiune refuzată: Contul tău este View-Only!');
            }

            const n = await Trip.destroy({ where: { id } });
            await logAction(user.username, user.role, `A șters călătoria ID ${id}`);
            io.emit('tripsUpdated');
            return n > 0;
        }
    }
};

// ─────────────────────────────────────────────
// 8. APOLLO INITIALIZATION WITH CONTEXT PASSTHROUGH
// ─────────────────────────────────────────────
async function start() {
    await migrate();
    const apollo = new ApolloServer({
        typeDefs,
        resolvers,
        introspection: true,
        cache: "bounded",
        // Injectăm userul decodat din token în contextul GraphQL pentru a-l verifica în mutations
        context: ({ req }) => {
            const tokenHeader = req.headers.authorization || '';
            const user = getUserFromToken(tokenHeader);
            return { user };
        }
    });
    await apollo.start();

    apollo.applyMiddleware({
        app,
        path: '/graphql',
        cors: false
    });

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
        console.log(`🚀 API Infrastructure Online on Port ${PORT}`);
    });
}

start().catch(console.error);

module.exports = { app, server };