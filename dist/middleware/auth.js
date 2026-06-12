"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const authToken_1 = require("../utils/authToken");
async function authMiddleware(req, _res, next) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        if (token) {
            try {
                const user = await (0, authToken_1.findUserByAuthToken)(token);
                const expired = user?.authTokenExpiry != null && user.authTokenExpiry < new Date();
                if (user && !expired) {
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
