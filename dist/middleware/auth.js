"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const db_1 = require("../db");
async function authMiddleware(req, _res, next) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        if (token) {
            try {
                const user = await db_1.prisma.user.findUnique({ where: { authToken: token } });
                if (user) {
                    req.user = { id: user.id, email: user.email, role: user.role };
                }
            }
            catch (err) {
                console.error("Error in authMiddleware:", err);
            }
        }
    }
    next();
}
