const express = require("express");
const { Server } = require("socket.io");
const http = require("http");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
    },
});

const db = new sqlite3.Database("./chat.db", (err) => {
    if(err) {
        console.error("Ошибка подключения к БД: ", err);
    }
    else {
        console.log("Подключено к БД chat.db");

        db.run("create table if not exists users(id integer primary key autoincrement, name text unique not null)");
        db.run("create table if not exists messages(id integer primary key autoincrement, senderid integer, receiverid integer, message text, timestamp datetime default current_timestamp, foreign key(senderid) references users(id), foreign key(receiverid) references users(id))");
    }
})

io.on("connection", (socket) => {
    console.log("Пользователь подключился");

    //проверка существования пользователя или создание нового
    socket.on("checkUser", (name, callback) => {
        db.get("select id from users where name = ?", [name], (err, row) => {
            //если ошибка запроса - отправляем ее текст
            if(err) {
                console.error(err);
                callback({success: false, error: "Ошибка БД"});
            } 
            //если пользователь найден - отправляем его id
            else if(row) {
                callback({success: true, userId: row.id});
            } 
            //если нет ошибки и пользователь не найден, значит, такого нет. создаем нового
            else {
                db.run("insert into users(name) values(?)", [name], (err) => {
                    if(err) {
                        console.error(err);
                        callback({success: false, error: "Ошибка добавления пользователя"});
                    } else {
                        callback({success: true, userId: this.lastID});
                    }
                })
            }
        })
    })

    //отправка и сохранение сообщений
    socket.on("sendMessage", (data) => {
        const {senderid, receiverName, message} = data;
        db.get("select id from users where name = ?", [receiverName], (err, row) => {
            if(err || !row) {
                //уведомление отправителю
                socket.emit("error", "Получатель не найден");
                return;
            } 
            //получаем id получателя сообщения
            const receiverid = row.id;

            db.run("insert into messages(senderid, receiverid, message) values(?,?,?)", [senderid, receiverid, message], (err) => {
                if(err) {
                    console.error(err);
                    //уведомление отправителю
                    socket.emit("error", "Сообщение не отправлено");
                } else {
                    //уведомление отправителю и получателю
                    io.emit("newMessage", {senderid, receiverid, message});
                }
            })
        })
    })

    //получение списка пользователей
    socket.on("getUsers", (callback) => {
        db.all("select name from users", [], (err, rows) => {
            if(err) {
                console.error(err);
                callback([]);
            } else {
                //отправляем только имена
                callback(rows.map((row) => row.name));
            }
        })
    })

    //загрузка переписки между двумя пользователями
    socket.on("getMessages", (data, callback) => {
        const {userId, receiverUserName} = data;
        //находим id получателя
        db.get("select id from users where name = ?", [receiverUserName], (err, row) => {
            if(err || !row) {
                callback([]);
                return;
            }
            const receiverUserId = row.id;

            //загружаем сообщения между двумя пользователями в случае если мы отправитель, а другой получатель, и наоборот
            db.all("select senderid, receiverid, message, timestamp from messages where (senderid = ? and receiverid = ?) or (senderid = ? and receiverid = ?) order by timestamp", [userId, receiverUserId, receiverUserId, userId], (err, rows) => {
                if(err) {
                    console.log(err);
                    callback([]);
                } else {
                    callback(rows);
                }
            })
        })
    })

    socket.on("disconnect", () => {
        console.log("Пользователь отключился");
    });
});

server.listen(5555, () => {
    console.log("Сервер запущен по адресу http://localhost:5555");
});
