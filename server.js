/*
Copyright (C) 2013 Hélio Dolores (heliodolores[at]gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
var Chat;
(function (Chat) {
    (function (ChatStatusServer) {
        ChatStatusServer[ChatStatusServer["ONLINE"] = 0] = "ONLINE";
        ChatStatusServer[ChatStatusServer["AWAY"] = 1] = "AWAY";
        ChatStatusServer[ChatStatusServer["BUSY"] = 2] = "BUSY";
        ChatStatusServer[ChatStatusServer["OFFLINE"] = 3] = "OFFLINE";
    })(Chat.ChatStatusServer || (Chat.ChatStatusServer = {}));
    var ChatStatusServer = Chat.ChatStatusServer;

    var UserSessions = (function () {
        function UserSessions() {
            this.sessions = new Array();
        }
        UserSessions.prototype.AddSession = function (sessionKey) {
            if (this.sessions.length > 5) {
                // MAX 5 Active sessions
                this.sessions.splice(0, 1);
            }
            this.sessions.push(sessionKey);
        };

        UserSessions.prototype.IsValidSession = function (sessionKey) {
            for (var i = 0; i < this.sessions.length; i++) {
                if (sessionKey == this.sessions[i])
                    return true;
            }
            return false;
        };
        return UserSessions;
    })();

    var ChatUser = (function () {
        function ChatUser(userUID, name, isDisabled, pictureHash) {
            this.userUID = userUID;
            this.name = name;
            this.activeSockets = {};
            this.isOffline = true;
            this.lastChatPing = new Date();
            this.lastCheckInactive = new Date();
            this.status = ChatStatusServer.ONLINE;
            this.isDisabled = isDisabled;
            this.blocked = [];
            this.contacts = [];
            this.pictureHash = pictureHash;
        }
        // 1 User can have multiple sockets (each browser tab creates a new socket)
        ChatUser.prototype.AddSocket = function (socket) {
            var setOnline;
            if (this.isOffline && this.IsInactive() && this.status == ChatStatusServer.AWAY) {
                // it was idle after being offline
                setOnline = true;
            }
            this.activeSockets[socket.id] = socket;
            this.Ping();
            if (this.isOffline && this.status != ChatStatusServer.OFFLINE) {
                this.isOffline = false;
                if (setOnline) {
                    this.status = ChatStatusServer.ONLINE;
                }
                this.BroadcastStatus();
            }
            this.isOffline = false;
        };

        ChatUser.prototype.RemoveSocket = function (id) {
            var _this = this;
            delete this.activeSockets[id];
            clearTimeout(this.timeout);
            if (this.CountSockets() == 0) {
                this.timeout = setTimeout(function () {
                    if (_this.CountSockets() == 0) {
                        _this.isOffline = true;
                        _this.BroadcastStatus();
                    }
                }, 10000);
            }
        };

        ChatUser.prototype.CountSockets = function () {
            var i = 0;
            for (var socket in this.activeSockets) {
                i++;
            }
            return i;
        };

        ChatUser.prototype.ReceiveMessage = function (kind, data, activity, from) {
            if (this.isDisabled || this.IsBlocked(from))
                return;
            for (var socket in this.activeSockets) {
                this.activeSockets[socket].emit(kind, data);
            }
            if (activity)
                this.Ping();
        };

        ChatUser.prototype.ReceiveMessageInSocket = function (socket, kind, data, activity, from) {
            if (this.isDisabled || this.IsBlocked(from))
                return;
            socket.emit(kind, data);
            if (activity)
                this.Ping();
        };

        ChatUser.prototype.AddAsContact = function (contact) {
            this.contacts.push(contact);
        };

        ChatUser.prototype.BroadcastToContacts = function (kind, data, activity, from) {
            for (var contact in this.contacts) {
                this.contacts[contact].ReceiveMessage(kind, data, false, from);
            }
            if (activity)
                this.Ping();
        };

        ChatUser.prototype.BroadcastStatus = function () {
            for (var contact in this.contacts) {
                var data = {
                    userKey: this.userUID,
                    statusId: this.GetStatus(this.contacts[contact])
                };
                this.contacts[contact].ReceiveMessage("NewStatus", data, false, this);
            }
            var status = {
                userKey: this.userUID,
                statusId: this.GetStatus(this)
            };
            this.ReceiveMessage("NewStatus", status, false, this);
        };

        ChatUser.prototype.SetStatus = function (status) {
            this.status = status;
            this.Ping();
            this.BroadcastStatus();
        };

        ChatUser.prototype.IsInactive = function () {
            var now = new Date();
            return (now.getTime() - this.lastChatPing.getTime()) > 120000;
        };

        ChatUser.prototype.OfflineDeamonCall = function () {
            var now = new Date();
            var timeSinceLastIdleCheck = now.getTime() - this.lastCheckInactive.getTime();
            if (!this.isOffline && (this.IsInactive() && timeSinceLastIdleCheck > 300000)) {
                this.isOffline = true;
                this.BroadcastStatus();
            }
        };

        ChatUser.prototype.Ping = function () {
            this.lastChatPing = new Date();
            this.lastCheckInactive = new Date();
            if (this.isInactive) {
                this.isInactive = false;
                this.BroadcastStatus();
            }
            if (this.isOffline) {
                this.isOffline = false;
                this.BroadcastStatus();
            }
        };

        ChatUser.prototype.Disable = function () {
            this.isDisabled = true;
            this.BroadcastStatus();
        };

        ChatUser.prototype.Enable = function () {
            this.isDisabled = false;
            this.BroadcastStatus();
        };

        ChatUser.prototype.IsBlocked = function (target) {
            for (var i = 0; i < this.blocked.length; i++) {
                if (this.blocked[i] === target)
                    return true;
            }
            return false;
        };

        ChatUser.prototype.BlockUser = function (target) {
            for (var i = 0; i < this.blocked.length; i++) {
                if (this.blocked[i] === target)
                    return;
            }
            this.blocked.push(target);
            this.BroadcastStatus();
        };

        ChatUser.prototype.UnbockUser = function (target) {
            for (var i = 0; i < this.blocked.length; i++) {
                if (this.blocked[i] === target) {
                    this.blocked.splice(i, 1);
                    this.BroadcastStatus();
                    return;
                }
            }
        };

        ChatUser.prototype.CheckIdle = function () {
            if (this.IsInactive() && !this.isInactive) {
                this.BroadcastStatus();
                this.isInactive = true;
            }
            this.lastCheckInactive = new Date();
        };

        ChatUser.prototype.GetStatus = function (whoWantsToKnow) {
            if (this.IsBlocked(whoWantsToKnow)) {
                return ChatStatusServer.OFFLINE;
            }
            if (this.isOffline || this.isDisabled) {
                return ChatStatusServer.OFFLINE;
            }
            if (this.IsInactive() && (this.status == ChatStatusServer.ONLINE || this.status == ChatStatusServer.AWAY)) {
                // IDLE
                return ChatStatusServer.AWAY;
            }
            return this.status;
        };

        ChatUser.prototype.SetPictureHash = function (newpictureHash) {
            this.pictureHash = newpictureHash;
        };
        return ChatUser;
    })();

    var ChatParticipant = (function () {
        function ChatParticipant(user, chat) {
            this.chat = chat;
            this.user = user;
        }
        ChatParticipant.prototype.ReceiveMessage = function (kind, data, from) {
            this.user.ReceiveMessage(kind, data, this.user.userUID == from.userUID, from);
        };
        return ChatParticipant;
    })();

    var ChatInstance = (function () {
        function ChatInstance(id) {
            this.participants = new Array();
            this.chatUID = id;
            this.n = 0;
        }
        ChatInstance.prototype.AddParticipant = function (user) {
            if (this.participants[user.userUID] != null)
                return;
            this.n++;
            var newparticipant = new ChatParticipant(user, this);
            this.participants[user.userUID] = newparticipant;
            if (this.n > 2) {
                this.isGroupChat = true;
            }
        };

        ChatInstance.prototype.RemoveParticipant = function (userid) {
            if (this.participants[userid] == null)
                return;
            this.n--;
            delete this.participants[userid];
        };

        ChatInstance.prototype.GetParticipants = function () {
            return this.participants;
        };

        ChatInstance.prototype.GetParticipantKeys = function () {
            var res = [];
            for (var key in this.participants) {
                res.push(key);
            }
            return res;
        };

        ChatInstance.prototype.BroadcastToChat = function (kind, msg, from) {
            for (var key in this.participants) {
                this.participants[key].ReceiveMessage(kind, msg, from);
            }
        };
        return ChatInstance;
    })();

    var ChatServer = (function () {
        function ChatServer(nodePort, nodeUsesHttps, backendServer, localServer, backendUsesHttps, backendPrivateKey, backendExtension) {
            this.nodePort = nodePort;
            this.nodeUsesHttps = nodeUsesHttps;
            this.backendServer = backendServer;
            this.localServer = localServer;
            this.backendUsesHttps = backendUsesHttps;
            this.backendPrivateKey = backendPrivateKey;
            this.backendExtension = backendExtension;
            this.METHOD_DISABLE = 'SetDisabled.';
            this.METHOD_BLOCK = 'SetBlocked.';
            this.METHOD_MSGSEEN = 'SetLastMessageSeen.';
            this.METHOD_MSGNEW = 'SetNewMessage.';
            this.METHOD_CHANGEPIC = 'SetPicture.';
            this.METHOD_LEAVE = 'SetLeaveConversation.';
            this.METHOD_JOIN = 'SetAddToConversation.';
            this.METHOD_PENDING = 'GetPendingChatIds.';
            this.METHOD_PREVIEW = 'GetLatestChatsPreview.';
            this.METHOD_CONTACTS = 'GetContactList.';
            this.METHOD_INFO = 'GetChatInfo.';
            this.METHOD_USERS = 'GetAllUsers.';
            this.METHOD_FILE = 'SetFile.';
            this.users = new Array();
            this.chats = new Array();
            this.activeSessions = new Array();
            this.Start();
        }
        ChatServer.prototype.Start = function () {
            var _this = this;
            // Internal Communications
            var server;
            if (this.nodeUsesHttps) {
                console.log();
                console.log("################################################################################");
                console.log("# HTTPS ALERT: PLEASE CONFIGURE THE HTTPS CERTIFICATE AND CONFIGURE BACKOFFICE #");
                console.log("# Search for this message in the code to configure it                          #");
                console.log("# Chat Backoffice: http://<your_server>/chat                                   #");
                console.log("################################################################################");
                console.log();
                var options = {
                    // GENERATE OPEN SSL CERTIFICATE:
                    // openssl genrsa -out privatekey.pem 1024
                    // openssl req -new -key privatekey.pem -out certrequest.csr
                    // openssl x509 -req -in certrequest.csr -signkey privatekey.pem -out certificate.pem
                    key: Utils.FILESYSTEM.readFileSync('privatekey.pem'),
                    cert: Utils.FILESYSTEM.readFileSync('certificate.pem')
                };
                server = Utils.HTTPS.createServer(options, function (req, res) {
                    _this.HandleInternalRequest(req, res);
                });
            } else {
                server = Utils.HTTP.createServer(function (req, res) {
                    _this.HandleInternalRequest(req, res);
                });
            }
            this.internallistener = server.listen(this.nodePort, this.localServer);

            // Socket Communications
            this.listener = Utils.IO.listen(server, this.localServer);
            this.InitChatCommunications();
            this.StatusDeamon();
        };

        ChatServer.prototype.StatusDeamon = function () {
            var _this = this;
            setInterval(function () {
                for (var user in _this.users) {
                    _this.users[user].OfflineDeamonCall();
                }
            }, 10000);
        };

        ChatServer.prototype.StoreChat = function (id, users) {
            var chat = this.chats[id];
            if (chat == null) {
                chat = new ChatInstance(id);
                this.chats[id] = chat;
            }
            for (var i = 0; i < users.length; i++) {
                chat.AddParticipant(users[i]);
            }
        };

        ChatServer.prototype.UpdateSessionKey = function (userUID, sessionKey) {
            if (this.activeSessions[userUID] == null) {
                this.activeSessions[userUID] = new UserSessions();
            }
            this.activeSessions[userUID].AddSession(sessionKey);
        };

        ChatServer.prototype.IsValidSession = function (userKey, sessionKey) {
            return this.activeSessions[userKey] != null && this.activeSessions[userKey].IsValidSession(sessionKey);
        };

        // Receive and handle internal function calls: OS => Node.JS
        ChatServer.prototype.HandleInternalRequest = function (req, res) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('done!\n');

            // Parse URL to JSON
            var jsonQuery = Utils.URL.parse(req.url, true).query;

            switch (jsonQuery.method) {
                case "sessionkeyupdate":
                    console.log("registering user: " + jsonQuery.userKey);
                    this.UpdateSessionKey(jsonQuery.userKey, jsonQuery.sessionKey);
                    break;
                default:
                    break;
            }
        };

        ChatServer.prototype.OpenChatAux = function (socket, userKey, sessionKey, chatId, restore, target, startGroupChat, startopen) {
            var _this = this;
            var options;
            if (target == null) {
                // Regular get chat by chatId
                options = { "SessionKey": sessionKey, "UserKey": userKey, "ChatKey": chatId, "DateTime": Utils.GetDateTimeForURL() };
            } else {
                if (startGroupChat) {
                    // start group chat based on chatId adding target user
                    options = { "SessionKey": sessionKey, "UserKey": userKey, "TargetUserKey": target, "DateTime": Utils.GetDateTimeForURL(), "StartGroupChat": true, "ChatKey": chatId };
                } else {
                    // Open chat with target user
                    options = { "SessionKey": sessionKey, "UserKey": userKey, "TargetUserKey": target, "DateTime": Utils.GetDateTimeForURL() };
                }
            }

            Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_INFO), this.backendUsesHttps ? 443 : 80, options, function (obj) {
                var participants = obj.Participants;
                var inactiveParticipants = obj.InactiveParticipants;
                var participantsInfo = {};

                var arr = new Array();
                var blocked = 0;
                for (var i = 0; i < participants.length; i++) {
                    var user = _this.users[participants[i]];
                    if (_this.users[userKey].IsBlocked(user)) {
                        blocked++;
                    }
                    arr.push(user);
                    var pInfo = { name: user.name, picHash: user.pictureHash };
                    participantsInfo[participants[i]] = pInfo;
                }
                if (blocked == participants.length - 1) {
                    return;
                }
                for (var i = 0; i < inactiveParticipants.length; i++) {
                    var user = _this.users[inactiveParticipants[i]];
                    var pInfo = { name: user.name, picHash: user.pictureHash };
                    participantsInfo[inactiveParticipants[i]] = pInfo;
                }
                _this.StoreChat(obj.ChatKey, arr);
                var res = {
                    ChatKey: obj.ChatKey,
                    Participants: obj.Participants,
                    Messages: obj.Messages,
                    InactiveParticipants: obj.InactiveParticipants,
                    restore: restore,
                    participantsInfo: participantsInfo,
                    startOpen: startopen
                };
                _this.users[userKey].ReceiveMessageInSocket(socket, "OpenChat", res, true);
            });
        };

        ChatServer.prototype.LoadUsers = function () {
            var _this = this;
            Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_USERS), this.backendUsesHttps ? 443 : 80, { "ChatKey": this.backendPrivateKey }, function (obj) {
                for (var i = 0; i < obj.API_Contacts.length; i++) {
                    var id = obj.API_Contacts[i].UserId;
                    var name = obj.API_Contacts[i].Name;
                    var picturehash = obj.API_Contacts[i].PictureHash;
                    var isdisabled = obj.API_Contacts[i].Disabled;
                    _this.users[id] = new ChatUser(id, name, isdisabled, picturehash);
                }
            });
        };

        ChatServer.prototype.HasFailed = function (res) {
            try  {
                var failed = typeof res.Value !== "undefined" && res.Value.indexOf("Error") == 0;
                if (failed) {
                    console.log("---------------<ERROR>-----------------");
                    console.log(res.Value);
                    console.log("---------------</ERROR>----------------");
                }
                return failed;
            } catch (error) {
                console.log("---------------<EXCEPTION>-----------------");
                console.log(error);
                console.log("---------------</EXCEPTION>----------------");
                return true;
            }
        };

        ChatServer.prototype.InitChatCommunications = function () {
            var _this = this;
            this.LoadUsers();

            this.listener.on('connection', function (socket) {
                socket.on('login', function (data) {
                    _this.SafeExecute(function () {
                        _this.Login(socket, data);
                    });
                });
                socket.on('openChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.OpenChat(socket, data);
                    });
                });
                socket.on('startChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.StartChat(socket, data);
                    });
                });
                socket.on('changePIC', function (data) {
                    _this.SafeExecute(function () {
                        _this.ChangePicture(socket, data);
                    });
                });
                socket.on('seenMessages', function (data) {
                    _this.SafeExecute(function () {
                        _this.SeenMessages(socket, data);
                    });
                });

                // CHAT PARTICIPANT OPERATIONS
                socket.on('addToChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.AddToChat(socket, data);
                    });
                });
                socket.on('leaveChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.LeaveChat(socket, data);
                    });
                });
                socket.on('sendMessage', function (data) {
                    _this.SafeExecute(function () {
                        _this.SendMessage(socket, data);
                    });
                });
                socket.on('sendFile', function (data) {
                    _this.SafeExecute(function () {
                        _this.SendFile(socket, data);
                    });
                });

                // NO OS SERVER INTERACTION
                socket.on('blockUser', function (data) {
                    _this.SafeExecute(function () {
                        _this.BlockUser(socket, data);
                    });
                });
                socket.on('unblockUser', function (data) {
                    _this.SafeExecute(function () {
                        _this.UnblockUser(socket, data);
                    });
                });
                socket.on('changeStatus', function (data) {
                    _this.SafeExecute(function () {
                        _this.ChangeStatus(socket, data);
                    });
                });
                socket.on('startedTypingOnChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.StartedTyping(socket, data);
                    });
                });
                socket.on('endedTypingOnChat', function (data) {
                    _this.SafeExecute(function () {
                        _this.EndedTyping(socket, data);
                    });
                });
                socket.on('disable', function (data) {
                    _this.SafeExecute(function () {
                        _this.Disable(socket, data);
                    });
                });
                socket.on('enable', function (data) {
                    _this.SafeExecute(function () {
                        _this.Enable(socket, data);
                    });
                });
                socket.on('disconnect', function () {
                    _this.SafeExecute(function () {
                        _this.Disconnect(socket);
                    });
                });
                socket.on('ping', function () {
                    _this.SafeExecute(function () {
                        _this.Ping(socket);
                    });
                });
                socket.on('checkIdle', function () {
                    _this.SafeExecute(function () {
                        _this.CheckIdle(socket);
                    });
                });
            });
        };

        ChatServer.prototype.SafeExecute = function (f) {
            try  {
                f();
            } catch (error) {
                console.log("Handler error: " + error);
            }
        };

        ChatServer.prototype.GetMethod = function (id) {
            return id + this.backendExtension;
        };

        ChatServer.prototype.Login = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.requestUserKey, data.sessionKey)) {
                console.log(data.requestUserKey + " is logged in!");

                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_CONTACTS), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "RequestUserKey": data.requestUserKey }, function (obj) {
                    if (_this.HasFailed(obj)) {
                        socket.emit('LoadError');
                    } else {
                        var me = obj.My_Info;
                        var mychatuser = _this.users[me.UserId];
                        if (mychatuser == null) {
                            mychatuser = new ChatUser(me.UserId, me.Name, me.Disabled, me.PictureHash);
                            _this.users[me.UserId] = mychatuser;
                        }
                        var disabled = _this.users[me.UserId].isDisabled;
                        var myInfo = { name: me.Name, id: me.UserId, picHash: me.PictureHash, status: ChatStatusServer.OFFLINE, disabled: disabled, blocked: me.Blocked };
                        var JSONContacts = { MyInfo: myInfo };

                        for (var i = 0; i < obj.API_Contacts.length; i++) {
                            var id = obj.API_Contacts[i].UserId;
                            var name = obj.API_Contacts[i].Name;
                            var hash = obj.API_Contacts[i].PictureHash;
                            var isdisabled = obj.API_Contacts[i].Disabled;
                            var contact = _this.users[id];
                            if (contact == null) {
                                contact = new ChatUser(id, name, isdisabled, hash);
                                _this.users[id] = contact;
                            }
                            var status = contact.GetStatus(mychatuser);
                            if (!disabled) {
                                var cInfo = { name: obj.API_Contacts[i].Name, status: status, picHash: hash };
                                JSONContacts[id] = cInfo;
                            }
                            contact.AddAsContact(mychatuser);
                        }

                        mychatuser.AddSocket(socket);
                        for (var blocked in me.Blocked) {
                            mychatuser.BlockUser(_this.users[me.Blocked[blocked]]);
                        }
                        mychatuser.Ping();
                        myInfo.status = mychatuser.GetStatus(mychatuser);

                        // store user info in socket object
                        socket["userId"] = me.UserId;
                        socket.emit("ContactsInfo", JSONContacts);
                        if (!disabled) {
                            var toRestore = data.restoreChats;
                            if (!data.mobileView) {
                                _this.RestoreChats(socket, data, me, toRestore);
                            }
                            Utils.RESTCall(_this.backendServer, _this.backendUsesHttps, 'GET', 'Chat', _this.GetMethod(_this.METHOD_PREVIEW), _this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.requestUserKey }, function (obj) {
                                if (_this.HasFailed(obj))
                                    return;

                                var result = new Array();

                                for (var p in obj) {
                                    var participants = obj[p].Participants;
                                    var inactiveParticipants = obj[p].InactiveParticipants;
                                    var participantsInfo = {};

                                    var arr = new Array();
                                    var blocked = 0;
                                    for (var i = 0; i < participants.length; i++) {
                                        var user = _this.users[participants[i]];
                                        if (_this.users[me.UserId].IsBlocked(user)) {
                                            blocked++;
                                        }
                                        arr.push(user);
                                        var pInfo = { name: user.name, picHash: user.pictureHash };
                                        participantsInfo[participants[i]] = pInfo;
                                    }
                                    if (blocked == participants.length - 1) {
                                        continue;
                                    }
                                    for (var i = 0; i < inactiveParticipants.length; i++) {
                                        var user = _this.users[inactiveParticipants[i]];
                                        var pInfo = { name: user.name, picHash: user.pictureHash };
                                        participantsInfo[inactiveParticipants[i]] = pInfo;
                                    }

                                    var res = {
                                        ChatKey: obj[p].ChatKey,
                                        Message: obj[p].Message,
                                        IsUnread: obj[p].IsUnread,
                                        Participants: obj[p].Participants,
                                        InactiveParticipants: obj[p].InactiveParticipants,
                                        participantsInfo: participantsInfo
                                    };
                                    result.push(res);
                                }
                                socket.emit("PreviewInfo", result);
                            });
                        }
                    }
                });
            } else {
                console.log("Connection refused for " + data.requestUserKey + " : invalid session key!");
                socket.emit("Refused");
                return;
            }
        };

        ChatServer.prototype.RestoreChats = function (socket, data, me, toRestore) {
            var _this = this;
            Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_PENDING), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.requestUserKey }, function (obj) {
                if (_this.HasFailed(obj)) {
                    socket.emit('LoadError');
                } else {
                    var opened = new Array();
                    for (var cid in obj) {
                        _this.OpenChatAux(socket, me["UserId"], data.sessionKey, obj[cid], false, null, false, false);
                        opened.push(obj[cid]);
                    }
                    for (var cid in toRestore) {
                        if (opened.indexOf(toRestore[cid]) == -1) {
                            _this.OpenChatAux(socket, me["UserId"], data.sessionKey, toRestore[cid], true, null, false, false);
                        }
                    }
                }
            });
        };

        ChatServer.prototype.StartChat = function (socket, data) {
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                this.OpenChatAux(socket, data.userKey, data.sessionKey, null, false, data.targetUserKey, false, true);
            }
        };

        ChatServer.prototype.OpenChat = function (socket, data) {
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                this.OpenChatAux(socket, data.userKey, data.sessionKey, data.chatKey, false, null, false, data.startOpen);
            }
        };

        ChatServer.prototype.AddToChat = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey) && this.chats[data.chatKey].GetParticipantKeys().indexOf(data.userKey) > -1) {
                var chats = this.chats;
                var user = this.users[data.userKey];
                var chat = chats[data.chatKey];
                if (chat != null && chat.isGroupChat) {
                    Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_JOIN), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "TargetUserKey": data.targetUserKey, "DateTime": Utils.GetDateTimeForURL(), "ChatKey": data.chatKey }, function (obj) {
                        if (_this.HasFailed(obj)) {
                            var info = "$ERROR_INFO$Something went wrong. Please retry.$END_INFO$";
                            var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                            _this.users[data.userKey].ReceiveMessage("NewMessage", message, false, user);
                        } else {
                            var res = {
                                chatKey: data.chatKey,
                                participantsInfo: {}
                            };
                            chat.AddParticipant(_this.users[data.targetUserKey]);
                            var participants = chat.GetParticipantKeys();
                            for (var i = 0; i < participants.length; i++) {
                                var participant = _this.users[participants[i]];
                                var pinfo = { name: participant.name, picHash: participant.pictureHash };
                                res.participantsInfo[participants[i]] = pinfo;
                            }

                            var info = "$INFO$Added " + _this.users[data.targetUserKey].name + " to the conversation.$END_INFO$";
                            Utils.RESTCall(_this.backendServer, _this.backendUsesHttps, 'POST', 'Chat', _this.GetMethod(_this.METHOD_MSGNEW), _this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "ChatKey": data.chatKey, "DateTime": Utils.GetDateTime(), "Message": info }, function (obj) {
                                if (_this.HasFailed(obj))
                                    return;
                                chat.BroadcastToChat("UserAdded", res, user);
                                var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                                chat.BroadcastToChat("NewMessage", message, user);
                            });
                        }
                    });
                } else {
                    this.OpenChatAux(socket, data.userKey, data.sessionKey, data.chatKey, false, data.targetUserKey, true, true);
                }
            }
        };
        ChatServer.prototype.LeaveChat = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey) && this.chats[data.chatKey].GetParticipantKeys().indexOf(data.userKey) > -1) {
                var chat = this.chats[data.chatKey];
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_LEAVE), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "DateTime": Utils.GetDateTimeForURL(), "ChatKey": data.chatKey }, function (obj) {
                    if (_this.HasFailed(obj)) {
                        var info = "$ERROR_INFO$Something went wrong. Please retry.$END_INFO$";
                        var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                        _this.users[data.userKey].ReceiveMessage("NewMessage", message, false, user);
                    } else {
                        var res = {
                            chatKey: data.chatKey,
                            userKey: data.userKey
                        };
                        chat.RemoveParticipant(data.userKey);

                        var user = _this.users[data.userKey];
                        user.ReceiveMessage("YouLeft", res, false, user);

                        var info = "$INFO$Left conversation.$END_INFO$";
                        Utils.RESTCall(_this.backendServer, _this.backendUsesHttps, 'POST', 'Chat', _this.GetMethod(_this.METHOD_MSGNEW), _this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "ChatKey": data.chatKey, "DateTime": Utils.GetDateTime(), "Message": info }, function (obj) {
                            if (_this.HasFailed(obj))
                                return;
                            chat.BroadcastToChat("UserLeft", res, user);
                            var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                            chat.BroadcastToChat("NewMessage", message, user);
                        });
                    }
                });
            }
        };
        ChatServer.prototype.SendMessage = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey) && this.chats[data.chatKey].GetParticipantKeys().indexOf(data.userKey) > -1) {
                data.msg = this.ProcessMessage(data.msg, data.chatKey);
                var user = this.users[data.userKey];

                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'POST', 'Chat', this.GetMethod(this.METHOD_MSGNEW), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "ChatKey": data.chatKey, "DateTime": Utils.GetDateTime(), "Message": data.msg }, function (obj) {
                    if (_this.HasFailed(obj)) {
                        var info = "$ERROR_INFO$Message failed.$END_INFO$";
                        var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                        user.ReceiveMessage("NewMessage", message, false, user);
                    } else {
                        var message = { userKey: data.userKey, chatKey: data.chatKey, message: data.msg, timestamp: (new Date()).getTime() };
                        _this.chats[data.chatKey].BroadcastToChat("NewMessage", message, _this.users[data.userKey]);
                    }
                });
            }
        };
        ChatServer.prototype.ChangePicture = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                var user = this.users[data.userKey];
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'POST', 'Chat', this.GetMethod(this.METHOD_CHANGEPIC), this.backendUsesHttps ? 443 : 80, data.postData, function (obj) {
                    if (_this.HasFailed(obj)) {
                        var info = "$ERROR_INFO$Change picture failed.$END_INFO$";
                        var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                        user.ReceiveMessage("NewMessage", message, false, user);
                    } else {
                        user.SetPictureHash(obj["hash"]);
                        var picture = { pictureHash: obj["hash"], userKey: data.userKey };
                        user.BroadcastToContacts("NewPIC", picture, true, user);
                        user.ReceiveMessage("NewPIC", picture, true, user);
                    }
                });
            }
        };
        ChatServer.prototype.SendFile = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey) && this.chats[data.chatKey].GetParticipantKeys().indexOf(data.userKey) > -1) {
                var user = this.users[data.userKey];
                data.postData.ChatKey = data.chatKey;
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'POST', 'Chat', this.GetMethod(this.METHOD_FILE), this.backendUsesHttps ? 443 : 80, data.postData, function (obj) {
                    if (_this.HasFailed(obj)) {
                        var info = "$ERROR_INFO$Send file failed.$END_INFO$";
                        var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                        user.ReceiveMessage("NewMessage", message, false, user);
                        user.ReceiveMessage("FileAck", data.chatKey, false, user);
                    } else {
                        // TODO : insert msg in same request
                        var msg = "$DWL$" + _this.users[data.userKey].name + "|" + data.postData['FileName'] + "|" + data.postData['FileType'] + "|" + obj.url + "|" + data.chatKey + "$DWL$";
                        Utils.RESTCall(_this.backendServer, _this.backendUsesHttps, 'POST', 'Chat', _this.GetMethod(_this.METHOD_MSGNEW), _this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "ChatKey": data.chatKey, "DateTime": Utils.GetDateTime(), "Message": msg }, function (res) {
                            if (_this.HasFailed(res)) {
                                var info = "$ERROR_INFO$Upload file message failed.$END_INFO$";
                                var message = { userKey: data.userKey, chatKey: data.chatKey, message: info, timestamp: (new Date()).getTime() };
                                user.ReceiveMessage("NewMessage", message, false, user);
                            }
                            var message = { userKey: data.userKey, chatKey: data.chatKey, message: msg, timestamp: (new Date()).getTime() };
                            user.ReceiveMessage("FileAck", data.chatKey, false, user);
                            _this.chats[data.chatKey].BroadcastToChat("NewMessage", message, user);
                        });
                    }
                });
            }
        };

        ChatServer.prototype.SeenMessages = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_MSGSEEN), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "ChatKey": data.chatKey, "DateTime": Utils.GetDateTimeForURL() }, function (res) {
                    _this.HasFailed(res);
                });
            }
        };
        ChatServer.prototype.BlockUser = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                var users = this.users;
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_BLOCK), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "TargetUserKey": data.targetUserKey, "Blocked": true }, function (res) {
                    if (!_this.HasFailed(res)) {
                        users[data.userKey].BlockUser(users[data.targetUserKey]);
                        var res = {
                            userKey: data.targetUserKey
                        };
                        socket.emit('BlockUser', res);
                    }
                });
            }
        };
        ChatServer.prototype.UnblockUser = function (socket, data) {
            var _this = this;
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                var users = this.users;
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_BLOCK), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "TargetUserKey": data.targetUserKey, "Blocked": false }, function (res) {
                    if (!_this.HasFailed(res)) {
                        users[data.userKey].UnbockUser(users[data.targetUserKey]);
                        var res = {
                            userKey: data.targetUserKey
                        };
                        socket.emit('UnblockUser', res);
                    }
                });
            }
        };
        ChatServer.prototype.ChangeStatus = function (socket, data) {
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                this.users[data.userKey].SetStatus(data.statusId);
            }
        };
        ChatServer.prototype.StartedTyping = function (socket, data) {
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                var res = { userKey: data.userKey, chatKey: data.chatKey };
                this.chats[data.chatKey].BroadcastToChat("StartedTypingOnChat", res, this.users[data.userKey]);
            }
        };
        ChatServer.prototype.EndedTyping = function (socket, data) {
            if (this.IsValidSession(data.userKey, data.sessionKey)) {
                var res = { userKey: data.userKey, chatKey: data.chatKey };
                this.chats[data.chatKey].BroadcastToChat("EndedTypingOnChat", res, this.users[data.userKey]);
            }
        };
        ChatServer.prototype.Disconnect = function (socket) {
            if (this.users[socket["userId"]] != null) {
                this.users[socket["userId"]].RemoveSocket(socket.id);
            }
        };
        ChatServer.prototype.Ping = function (socket) {
            if (this.users[socket["userId"]] != null) {
                this.users[socket["userId"]].Ping();
            }
        };
        ChatServer.prototype.Disable = function (socket, data) {
            var _this = this;
            if (this.users[socket["userId"]] != null) {
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_DISABLE), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "Disabled": true }, function (res) {
                    if (!_this.HasFailed(res)) {
                        _this.users[socket["userId"]].Disable();
                    }
                });
            }
        };
        ChatServer.prototype.Enable = function (socket, data) {
            var _this = this;
            if (this.users[socket["userId"]] != null) {
                Utils.RESTCall(this.backendServer, this.backendUsesHttps, 'GET', 'Chat', this.GetMethod(this.METHOD_DISABLE), this.backendUsesHttps ? 443 : 80, { "SessionKey": data.sessionKey, "UserKey": data.userKey, "Disabled": false }, function (res) {
                    if (!_this.HasFailed(res)) {
                        _this.users[socket["userId"]].Enable();
                    }
                });
            }
        };
        ChatServer.prototype.CheckIdle = function (socket) {
            if (this.users[socket["userId"]] != null) {
                this.users[socket["userId"]].CheckIdle();
            }
        };

        ChatServer.prototype.ProcessMessage = function (msg, chatKey) {
            msg = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
            return msg;
        };
        return ChatServer;
    })();
    Chat.ChatServer = ChatServer;
})(Chat || (Chat = {}));

var Utils;
(function (Utils) {
    // External Libs for Node.js
    Utils.HTTP = require('http');
    Utils.HTTPS = require('https');
    Utils.IO = require('socket.io');
    Utils.URL = require('url');
    Utils.QUERYSTRING = require('querystring');
    Utils.FILESYSTEM = require('fs');

    // Utilities
    function GenerateGUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = (c == 'x' ? r : (r & 0x3 | 0x8));
            return v.toString(16);
        });
    }
    Utils.GenerateGUID = GenerateGUID;

    function AddZero(num) {
        return (num >= 0 && num < 10) ? "0" + num : num + "";
    }

    function GetDateTimeForURL() {
        var now = new Date();
        return [
            [
                now.getFullYear(),
                AddZero(now.getMonth() + 1),
                AddZero(now.getDate())
            ].join("-"),
            [AddZero(now.getHours()), AddZero(now.getMinutes()), AddZero(now.getSeconds())].join("%3a")
        ].join("+");
    }
    Utils.GetDateTimeForURL = GetDateTimeForURL;

    function GetDateTime() {
        var now = new Date();
        return [
            [
                now.getFullYear(),
                AddZero(now.getMonth() + 1),
                AddZero(now.getDate())
            ].join("-"),
            [AddZero(now.getHours()), AddZero(now.getMinutes()), AddZero(now.getSeconds())].join(":")
        ].join(" ");
    }
    Utils.GetDateTime = GetDateTime;

    function QueryStringFromJSON(obj) {
        var querystring = '';
        for (var attribute in obj) {
            if (querystring != "") {
                querystring += "&";
            }
            querystring += attribute + "=" + obj[attribute];
        }
        return querystring;
    }
    Utils.QueryStringFromJSON = QueryStringFromJSON;

    function RESTCall(server, https, methodkind, applicationName, page, port, parameters, jsonhandler) {
        var isGET = methodkind == "GET";
        var qstring = isGET ? '?' + Utils.QueryStringFromJSON(parameters) : "";
        var data = Utils.QUERYSTRING.stringify(parameters);

        var headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': data.length
        };
        var optionsget = {
            host: server,
            port: port,
            path: '/' + applicationName + '/' + page + qstring,
            method: methodkind
        };

        if (!isGET) {
            optionsget["headers"] = headers;
        }
        var requestType;
        if (https) {
            requestType = Utils.HTTPS;
        } else {
            requestType = Utils.HTTP;
        }

        var reqGet = requestType.request(optionsget, function (res) {
            res.setEncoding('utf8');
            var jsonresponse = '';

            res.on('data', function (result) {
                jsonresponse += result;
            });

            res.on('end', function () {
                var obj = JSON.parse(jsonresponse);
                jsonhandler(obj);
            });
        });
        if (!isGET) {
            reqGet.write(data);
        }
        reqGet.end();
        console.log();
        reqGet.on('error', function (e) {
            console.error(e);
        });
    }
    Utils.RESTCall = RESTCall;
})(Utils || (Utils = {}));

// ON PREMISE
//var myserver = new Chat.ChatServer(/*nodePort*/80,/*nodeUsesHttps*/false, /*backendServer*/ "localhost",/*localServer*/"localhost",/*backendUsesHttps*/false,/*backendPrivateKey*/ "outsystemschatkey*._.'__ç",/*backendExtension*/ "aspx");
// for HEROKU use these values
// process.env.PORT
// process.env.IP
// RED HAT OPEN SHIFT CONFIGURATION
var myserver = new Chat.ChatServer(process.env.OPENSHIFT_NODEJS_PORT, false, "naffaell.outsystemscloud.com", process.env.OPENSHIFT_NODEJS_IP, false, "_*outsystemschatkey*_", "aspx");
//# sourceMappingURL=server.js.map
