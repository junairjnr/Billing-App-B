import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../modules/user/user.model.js";
import { notificationRoom } from "./notificationRooms.js";

/** @type {import("socket.io").Server | null} */
let io = null;

export function getIo() {
  return io;
}

/**
 * @param {import("http").Server} httpServer
 * @param {string[]} allowedOrigins
 */
export function createSocketServer(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      const user = await User.findById(decoded.id)
        .select("isActive companyId")
        .lean();

      if (!user?.isActive) {
        return next(new Error("Unauthorized"));
      }
      if (String(user.companyId) !== String(decoded.companyId)) {
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = String(user._id);
      socket.data.companyId = String(user.companyId);
      socket.data.subscribedRoom = null;

      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("notifications:subscribe", ({ financialYearId }) => {
      if (!financialYearId) return;

      const room = notificationRoom(socket.data.companyId, financialYearId);
      if (socket.data.subscribedRoom && socket.data.subscribedRoom !== room) {
        socket.leave(socket.data.subscribedRoom);
      }
      socket.join(room);
      socket.data.subscribedRoom = room;
    });

    socket.on("disconnect", () => {
      if (socket.data.subscribedRoom) {
        socket.leave(socket.data.subscribedRoom);
      }
    });
  });

  return io;
}
