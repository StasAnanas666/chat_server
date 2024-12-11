const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const mysql = require("mysql2/promise");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
    },
});

const pool = mysql.createPool({
    host: "sql7.freesqldatabase.com",
    user: "sql7750782",
    password: "d9yAiVKdJA",
    database: "sql7750782"
})
//инициализация БД
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        console.log("Подключено к БД chat");
        await connection.query("create table if not exists users(id int primary key auto_increment, name varchar(100) unique not null)");
        await connection.query("create table if not exists messages(id int primary key auto_increment, senderid int, receiverid int, message varchar(1000), timestamp timestamp default current_timestamp, foreign key(senderid) references users(id), foreign key(receiverid) references users(id))");
        //хранения статуса прочтения сообщения
        await connection.query("alter table messages add is_read boolean default false");
        console.log("Таблицы успешно созданы");
        connection.release();
    } catch (error) {
        console.error("Ошибка инициализации базы данных: ",  error);
    }
};

initializeDatabase();

io.on("connection", (socket) => {
    console.log("Пользователь подключился");

    //проверка существования пользователя или создание нового
    socket.on("checkUser", async(name, callback) => {
        try {
            const [rows] = await pool.query("select id from users where name = ?", [name]);
            if(rows.length > 0) {
                //если пользователь найден, отправляем его id
                callback({success: true, userId: rows[0].id});
                console.log("Пользователь найден: " + name);
            } else {
                //если пользователь не найден, добавляем нового
                const [result] = await pool.query("insert into users(name) values(?)", [name]);
                const newUser = {id: result.insertId, name};
                callback({success: true, userId: result.insertId});
                console.log("Пользователь добавлен в БД");
                //уведомление всех пользователей о новом пользователе
                io.emit("newUser", newUser);
            }
        } catch (error) {
            console.error(error);
            callback({success: false, error: "Ошибка БД"});
        }
    })

    //отправка и сохранение сообщений
    socket.on("sendMessage", async(data) => {
        const {senderid, receiverName, message} = data;
        try {
            const [rows] = await pool.query("select id from users where name = ?", [receiverName]);
            if(rows.length === 0) {
                //уведомление отправителю
                socket.emit("error", "Получатель не найден");
                return;
            }
            //получаем id получателя сообщения
            const receiverid = rows[0].id;
            const [result] = await pool.query("insert into messages(senderid, receiverid, message, is_read) values(?,?,?,false)", [senderid, receiverid, message]);
            const [rows1] = await pool.query("select timestamp from messages where id = ?", [result.insertId]);
            if(rows1.length === 0) {
                //уведомление отправителю
                socket.emit("error", "Получатель не найден");
                return;
            }
            const timestamp = rows1[0].timestamp;
            //уведомление отправителю и получателю
            io.emit("newMessage", {senderid, receiverid, message, timestamp});
            console.log("Сообщение добавлено в БД и отправлено пользователям");
        } catch (error) {
            console.error(error);
            //уведомление отправителю
            socket.emit("error", "Сообщение не отправлено");
        }
    })

    //получение количества непрочитанных сообщений
    socket.on("getUnreadMessages", async(userId, callback) => {
        try {
            const [rows] = await pool.query("select senderid, count(*) as unread_messages from messages where receiverid = ? and is_read = false group by senderid", [userId]);
            callback(rows);//список отправителей с количеством непрочитанных сообщений
        } catch (error) {
            console.error(error);
            callback([]);
        }
    })

    //отметка сообщений как прочитанных, когда открывается(или открыт) чат с пользователем
    socket.on("markAsRead", async(data) => {
        const {userId, senderName} = data;
        try {
            const [rows] = await pool.query("select id from users where name = ?", [senderName]);
            if(rows.length === 0) {
                //уведомление получателю
                socket.emit("error", "Отправитель не найден");
                return;
            }
            //получаем id отправителя сообщения
            const senderId = rows[0].id;
            await pool.query("update messages set is_read = true where receiverid = ? and senderid = ?", [userId, senderId]);
        } catch (error) {
            console.error(error);
        }
    })

    //получение списка пользователей
    socket.on("getUsers", async(callback) => {
        try {
            const [rows] = await pool.query("select * from users");
            callback(rows);
        } catch (error) {
            console.error(error);
            callback([]);
        }
    })

    //загрузка переписки между двумя пользователями
    socket.on("getMessages", async(data, callback) => {
        const {userId, receiverUserName} = data;
        //находим id получателя
        try {
            const [rows] = await pool.query("select id from users where name = ?", [receiverUserName]);
            if(rows.length === 0) {
                callback([]);
                return;
            }
            const receiverUserId = rows[0].id;

            //загружаем сообщения между двумя пользователями в случае если мы отправитель, а другой получатель, и наоборот
            const [messages] = await pool.query("select senderid, receiverid, message, timestamp from messages where (senderid = ? and receiverid = ?) or (senderid = ? and receiverid = ?) order by timestamp", [userId, receiverUserId, receiverUserId, userId]);
            callback(messages);
            console.log("Переписка отправлена");
        } catch (error) {
            console.log(error);
            callback([]);
        }
    })

    socket.on("disconnect", () => {
        console.log("Пользователь отключился");
    });
});

server.listen(5555, () => {
    console.log("Сервер запущен по адресу http://localhost:5555");
});
