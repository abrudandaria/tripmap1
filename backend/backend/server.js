'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { ApolloServer, gql } = require('apollo-server-express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const mongoose = require('mongoose');
const path = require('path');

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
// 2.  MONGODB SETUP (Mongoose - NoSQL for Chat)
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
// 3.  POSTGRESQL MODELS (GOLD ENHANCED)
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
    isSuspicious: { type: DataTypes.BOOLEAN, defaultValue: false }, // GOLD List
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

// ── GOLD AUDIT LOG MODEL ──
const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.TEXT, allowNull: false },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'audit_logs', timestamps: false });

// Associations
Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', as: 'roles' });
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
Role.hasMany(User, { foreignKey: 'roleId', as: 'users' });
Destination.hasMany(Trip, { foreignKey: 'destinationId', as: 'trips' });
Trip.belongsTo(Destination, { foreignKey: 'destinationId', as: 'destination' });

// ── GOLD LOGIC ENGINE: SYSTEM INTRUSION DETECTOR ──
async function logAction(userIdentifier, role, actionDescription) {
    try {
        await AuditLog.create({
            userId: String(userIdentifier),
            role: role,
            action: actionDescription
        });

        // Verificăm atacuri de tip Flood sau comportament malițios (mai mult de 3 acțiuni în ultimele 10 secunde)
        const tenSecondsAgo = new Date(Date.now() - 10000);
        const recentActionsCount = await AuditLog.count({
            where: {
                userId: String(userIdentifier),
                timestamp: { [Op.gte]: tenSecondsAgo }
            }
        });

        if (recentActionsCount > 3) {
            // Prindem utilizatorul indiferent dacă logarea s-a făcut după Username sau după ID numeric
            await User.update(
                { isSuspicious: true },
                {
                    where: {
                        [Op.or]: [
                            { id: isNaN(userIdentifier) ? -1 : Number(userIdentifier) },
                            { username: String(userIdentifier) }
                        ]
                    }
                }
            );
            console.log(`⚠️ STEALTH DETECTOR: User '${userIdentifier}' flagged as SUSPICIOUS (Flood detected)`);
        }
    } catch (err) {
        console.error('Audit log error:', err);
    }
}

// ─────────────────────────────────────────────
// 4.  DATABASE MIGRATION + SEED
// ─────────────────────────────────────────────
async function migrate() {
    await sequelize.authenticate();
    // Păstrăm force: true DOAR o tură ca să re-creăm tabela audit_logs pe curat.
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

    const adminCount = await User.count({ where: { roleId: adminRole.id } });
    if (adminCount === 0) {
        await User.create({ username: 'admin', password: 'admin123', roleId: adminRole.id });
        await User.create({ username: 'user1', password: 'user123', roleId: userRole.id });
    }

    const tripCount = await Trip.count();
    if (tripCount === 0) {
        const paris = await Destination.create({ city: 'Paris', country: 'France' });
        const tokyo = await Destination.create({ city: 'Tokyo', country: 'Japan' });
        await Trip.create({ price: 2500, days: 5, description: 'Orașul Luminilor.', destinationId: paris.id });
        await Trip.create({ price: 3800, days: 10, description: 'Tradiție și tehnologie.', destinationId: tokyo.id });
    }

    console.log('✅ Database migrated, seeded and Gold Audit active.');
}

// ─────────────────────────────────────────────
// 5.  HELPER
// ─────────────────────────────────────────────
const toGql = (trip) => ({
    id: String(trip.id),
    dest: trip.destination ? trip.destination.city : '',
    price: trip.price,
    days: trip.days,
    desc: trip.description || '',
});

const include = [{ model: Destination, as: 'destination' }];

// ─────────────────────────────────────────────
// 6.  EXPRESS + SOCKET.IO + REST ENDPOINTS
// ─────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// REST - Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({
        where: { username, password },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // GOLD Log
    await logAction(user.username, user.role.name, `User logged into the platform via REST`);

    res.json({
        id: user.id,
        username: user.username,
        role: user.role.name,
        permissions: user.role.permissions.map(p => p.name),
    });
});

// REST - Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || username.length < 3) return res.status(400).json({ error: 'Username too short (min 3 chars)' });
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short (min 4 chars)' });

    const existing = await User.findOne({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const userRole = await Role.findOne({ where: { name: 'user' } });
    const newUser = await User.create({ username, password, roleId: userRole.id });

    // GOLD Log
    await logAction(newUser.username, 'user', `Account successfully registered`);

    res.json({ id: newUser.id, username: newUser.username, role: 'user' });
});

// REST - GOLD STEALTH OBSERVATION LIST FOR ADMIN
app.get('/api/admin/suspicious', async (req, res) => {
    try {
        const suspiciousUsers = await User.findAll({
            where: { isSuspicious: true },
            attributes: ['id', 'username', 'updatedAt']
        });
        res.json(suspiciousUsers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// REST - NEW ROUTE FOR FRONTEND VISUAL AUDIT TRAILS PANEL
app.get('/api/admin/audit-logs', async (req, res) => {
    try {
        const logs = await AuditLog.findAll({
            order: [['timestamp', 'DESC']],
            limit: 100
        });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    const users = await User.findAll({
        include: [{ model: Role, as: 'role' }],
        attributes: ['id', 'username', 'createdAt'],
    });
    res.json(users.map(u => ({ id: u.id, username: u.username, role: u.role.name })));
});

app.get('/api/chat/:room', async (req, res) => {
    const messages = await Message.find({ room: req.params.room })
        .sort({ createdAt: -1 })
        .limit(50);
    res.json(messages.reverse());
});

app.get('/api/trips', async (req, res) => {
    const trips = await Trip.findAll({ include });
    res.json(trips.map(toGql));
});

app.get('/api/stats', async (req, res) => {
    const total = await Trip.count();
    const result = await Trip.findOne({
        attributes: [
            [sequelize.fn('AVG', sequelize.col('price')), 'avgPrice'],
            [sequelize.fn('MAX', sequelize.col('price')), 'maxPrice'],
        ],
        raw: true,
    });
    res.json({ totalTrips: total, avgPrice: result.avgPrice || 0, maxPrice: result.maxPrice || 0 });
});

app.get('/api/trips/filter', async (req, res) => {
    const { city, minPrice, maxPrice, minDays, maxDays } = req.query;
    const where = {};
    if (minPrice) where.price = { ...where.price, [Op.gte]: Number(minPrice) };
    if (maxPrice) where.price = { ...where.price, [Op.lte]: Number(maxPrice) };
    if (minDays) where.days = { ...where.days, [Op.gte]: Number(minDays) };
    if (maxDays) where.days = { ...where.days, [Op.lte]: Number(maxDays) };
    const destWhere = city ? { city: { [Op.like]: `%${city}%` } } : {};
    const trips = await Trip.findAll({
        where,
        include: [{ model: Destination, as: 'destination', where: destWhere }],
    });
    res.json(trips.map(toGql));
});

// ─────────────────────────────────────────────
// 7.  SOCKET.IO - Real-Time Chat + GOLD Logging
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
    socket.on('joinRoom', ({ username, room }) => {
        socket.join(room);
        socket.to(room).emit('chatMessage', {
            username: 'System',
            text: `${username} joined the room`,
            role: 'system',
            createdAt: new Date(),
        });
    });

    socket.on('sendMessage', async ({ username, role, text, room, userId }) => {
        const msg = new Message({ username, role, text, room });
        await msg.save();
        io.to(room).emit('chatMessage', { username, role, text, createdAt: msg.createdAt });

        // Căutăm utilizatorul hibrid: după numele de utilizator (trimis de websocket)
        const userIdentifier = username || userId || 'unknown';
        await logAction(userIdentifier, role || 'user', `Sent live chat message: "${text.substring(0, 30)}..."`);
    });

    socket.on('tripsUpdated', () => io.emit('tripsUpdated'));
});

// ─────────────────────────────────────────────
// 8.  GRAPHQL SCHEMA
// ─────────────────────────────────────────────
const typeDefs = gql`
  type Trip {
    id: ID!
    dest: String!
    price: Float!
    days: Int!
    desc: String
  }

  type Stats {
    avgPrice: Float!
    totalTrips: Int!
    maxPrice: Float!
  }

  type PaginatedTrips {
    total: Int!
    data: [Trip]!
    totalPages: Int!
  }

  type UserInfo {
    id: ID!
    username: String!
    role: String!
    permissions: [String]!
    isSuspicious: Boolean
  }

  type Query {
    getTrips(page: Int, city: String, minPrice: Float, maxPrice: Float): PaginatedTrips
    getStats: Stats
    ping: String
    getUsers: [UserInfo]
  }

  type Mutation {
    addTrip(dest: String!, price: Float!, days: Int!, desc: String): Trip
    updateTrip(id: ID!, dest: String!, price: Float!, days: Int!, desc: String): Trip
    deleteTrip(id: ID!): Boolean
    toggleGenerator(action: String!): String
    login(username: String!, password: String!): UserInfo
  }
`;

// ─────────────────────────────────────────────
// 9.  GRAPHQL RESOLVERS
// ─────────────────────────────────────────────
let generatorInterval = null;

const resolvers = {
    Query: {
        getTrips: async (_, { page = 1, city, minPrice, maxPrice }) => {
            const LIMIT = 5;
            const offset = (page - 1) * LIMIT;
            const tripWhere = {};
            if (minPrice != null && minPrice !== '') tripWhere.price = { ...tripWhere.price, [Op.gte]: Number(minPrice) };
            if (maxPrice != null && maxPrice !== '') tripWhere.price = { ...tripWhere.price, [Op.lte]: Number(maxPrice) };
            const destInclude = {
                model: Destination,
                as: 'destination',
                required: city ? true : false,
                ...(city ? { where: { city: { [Op.like]: `%${city}%` } } } : {}),
            };
            const { count, rows } = await Trip.findAndCountAll({
                where: tripWhere,
                include: [destInclude],
                limit: LIMIT,
                offset,
                order: [['createdAt', 'DESC']],
                distinct: true,
            });
            return { total: count, totalPages: Math.ceil(count / LIMIT) || 1, data: rows.map(toGql) };
        },

        getStats: async () => {
            const total = await Trip.count();
            const result = await Trip.findOne({
                attributes: [
                    [sequelize.fn('AVG', sequelize.col('price')), 'avgPrice'],
                    [sequelize.fn('MAX', sequelize.col('price')), 'maxPrice'],
                ],
                raw: true,
            });
            return { avgPrice: parseFloat(result?.avgPrice) || 0, maxPrice: parseFloat(result?.maxPrice) || 0, totalTrips: total };
        },

        ping: () => 'pong',

        getUsers: async () => {
            const users = await User.findAll({
                include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
            });
            return users.map(u => ({
                id: String(u.id),
                username: u.username,
                role: u.role.name,
                permissions: u.role.permissions.map(p => p.name),
                isSuspicious: u.isSuspicious
            }));
        },
    },

    Mutation: {
        login: async (_, { username, password }) => {
            const user = await User.findOne({
                where: { username, password },
                include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
            });
            if (!user) throw new Error('Invalid credentials');

            // GOLD Log via GraphQL
            await logAction(user.username, user.role.name, `User logged in via GraphQL`);

            return {
                id: String(user.id),
                username: user.username,
                role: user.role.name,
                permissions: user.role.permissions.map(p => p.name),
                isSuspicious: user.isSuspicious
            };
        },

        addTrip: async (_, { dest, price, days, desc }) => {
            if (!dest || dest.trim().length < 2) throw new Error('Destination name too short.');
            if (price < 0) throw new Error('Price cannot be negative.');
            if (days < 1) throw new Error('Duration must be at least 1 day.');
            const [destination] = await Destination.findOrCreate({ where: { city: dest.trim() }, defaults: { city: dest.trim() } });
            const trip = await Trip.create({ price: Number(price), days: Number(days), description: desc || '', destinationId: destination.id });
            io.emit('tripsUpdated');
            return toGql({ ...trip.toJSON(), destination });
        },

        updateTrip: async (_, { id, dest, price, days, desc }) => {
            const trip = await Trip.findByPk(id, { include });
            if (!trip) throw new Error('Trip not found');
            if (price < 0) throw new Error('Price cannot be negative.');
            const [destination] = await Destination.findOrCreate({ where: { city: dest.trim() }, defaults: { city: dest.trim() } });
            await trip.update({ price: Number(price), days: Number(days), description: desc || '', destinationId: destination.id });
            await trip.reload({ include });
            io.emit('tripsUpdated');
            return toGql(trip);
        },

        deleteTrip: async (_, { id }) => {
            const n = await Trip.destroy({ where: { id } });
            io.emit('tripsUpdated');
            return n > 0;
        },

        toggleGenerator: (_, { action }) => {
            if (action === 'start') {
                if (generatorInterval) return 'Running';
                generatorInterval = setInterval(async () => {
                    const cities = ['Berlin', 'Rome', 'Barcelona', 'Amsterdam', 'Vienna', 'Prague', 'Lisbon', 'Athens'];
                    const city = cities[Math.floor(Math.random() * cities.length)] + ' ' + Date.now();
                    const [dest] = await Destination.findOrCreate({ where: { city }, defaults: { city } });
                    await Trip.create({
                        price: Math.floor(Math.random() * 5000),
                        days: Math.floor(Math.random() * 14) + 1,
                        description: 'Generated by Gold Engine.',
                        destinationId: dest.id,
                    });
                    io.emit('tripsUpdated');
                }, 3000);
                return 'Started';
            } else {
                if (generatorInterval) { clearInterval(generatorInterval); generatorInterval = null; }
                return 'Stopped';
            }
        },
    },
};

// ─────────────────────────────────────────────
// 10. APOLLO STARTUP
// ─────────────────────────────────────────────
async function start() {
    await migrate();
    const apollo = new ApolloServer({ typeDefs, resolvers });
    await apollo.start();
    apollo.applyMiddleware({ app, path: '/graphql' });
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`🚀 Gold Server ready on port ${PORT}`));
}

start().catch(console.error);

module.exports = { app, sequelize, Trip, Destination, User, Role, Permission, Message, server };