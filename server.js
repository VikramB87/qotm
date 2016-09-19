'use strict';

const http = require('http');
const url  = require('url');
const fs = require('fs');
const path = require('path');
const templateEngine = require('./template_engine');
const sqlite = require('sqlite3').verbose();
const qs = require('querystring');
const crypto = require('crypto');
const mp = require('multiparty');

const FILE_ROOT = "wwwroot/";
const QUOTE_IMAGE_RELATIVE_PATH = "images/quote_images/";
const QUOTE_IMAGE_FULL_PATH = FILE_ROOT + QUOTE_IMAGE_RELATIVE_PATH;

const port = 8000;
const template_filename = 'qotd.html';
const QUOTES_FILENAME = 'thoughts.db';
const DEFAULT_IMAGE_GROUP_ID = 1;

var quotes = [];
var quotesForSearch = [];
var imageGroups = [];

function loadQuotes () {
    var db = new sqlite.Database (QUOTES_FILENAME);
    db.all ("SELECT * FROM quotes ORDER BY id", function (err, rows) {
        if (err !== null) {
            console.log ("Error querying quotes from DB: " + err.toString ());
        } else {
            for (var i = 0; i < rows.length; i++) {
                addQuote(rows[i]);
            }
            loadImageGroups (db);
        }
    });
}

function addQuote (row) {

    var q = {
        id    : row.id,
        quote : row.quote,
        author: row.author,
        source: row.source,
        createdOn: row.createdOn,
        notes: row.notes,
        imageGroupId: row.image_group
    };
    quotes.push(q);
    addToQuotesForSearch (q);
}

function loadImageGroups (db) {
    db.all ("SELECT * FROM image_group ORDER BY id", function (err, rows) {
        if (err !== null) {
            console.log ("Error querying image groups from DB: " + err.toString ());
        } else {
            loadImageGroup (db, rows, 0);
        }
    });
}

function loadImageGroup (db, rows, idx) {
    if (idx >= rows.length) {
        db.close ();
        console.log("Read " + quotes.length + " quotes");
        console.log("Read " + imageGroups.length + " image groups");
        return;
    }

    var row = rows[idx];

    var imgGroup = {
        id: row.id,
        name: row.name,
        images: []
    };
    imageGroups.push(imgGroup);
    readImagesOfGroup (db, imgGroup, () => {
        loadImageGroup(db, rows, idx+1);
    });
}

function readImagesOfGroup (db, imgGroup, then) {
    db.all ("SELECT path FROM image WHERE group_id=" + imgGroup.id,
            function (err, rows) {
                if (err !== null) {
                    console.log ("Error querying images from DB: " + err.toString ());
                } else {
                    for (var i = 0; i < rows.length; i++) {
                        var image = {
                            path: rows[i].path,
                        };
                        imgGroup.images.push(image);
                    }
                }
                then();
            });
}

function addToQuotesForSearch (quote, idx) {
    var q = {
        id     : quote.id,
        quote  : quote.quote.toLowerCase (),
        author : quote.author.toLowerCase (),
        source : quote.source.toLowerCase (),
        notes  : quote.notes.toLowerCase ()
    };
    if (idx === undefined) {
        quotesForSearch.push(q);
    } else {
        quotesForSearch[idx] = q;
    }
}

loadQuotes ();

var template = templateEngine.parseTemplate (fs.readFileSync (template_filename).toString());

fs.watch (template_filename, function (curr, prev) {
    template = templateEngine.parseTemplate (fs.readFileSync (template_filename).toString ());
});

const server = http.createServer(http_handler);
server.on ('connection', function (s) {
    logMessage("Connected to " + s.remoteAddress + ":" + s.remotePort);
});

function http_handler (req, res) {
    var method = req.method;
    var body = "";

    logMessage("Received " + method + " request from " + req.client.remoteAddress + ":" + req.client.remotePort +
            " for " + req.url);

    // Handling for multi-part request
    if (req.url == '/addgroup' && req.method == "POST") {
        addGroupResponse (req, res);
        return;
    }

    req.on('error', function(err) {
        console.error(err);
    }).on('data', function(chunk) {
        body += chunk;
    }).on('end', function() {

        if (req.url == '/qotd' || req.url == '/') {
            qotdResponse (res);
        } else if (req.url == '/singlequote') {
            singleQuoteResponse (res);
        } else if (req.url.startsWith('/searchquote')) {
            searchQuoteResponse (req.url, res);
        } else if (req.url.startsWith('/editquote')) {
            editQuoteResponse (req.url, res);
        } else if (req.url == '/addquote') {
            if (method == "POST") {
                addQuoteRespose (body, res);
            } else {
                res.statusCode = 200;
                res.setHeader ('Content-Type', 'text/plain');
                res.end ('Quote Added!');
            }
        } else if(req.url.startsWith('/editgroup')) {
            editGroupResponse(req.url, res);
        } else {
            serveStaticFile (req, res);
        }
    });
}

function randomInt (low, high) {
    return Math.floor(Math.random() * (high - low) + low);
}

function serveStaticFile (req, res) {
    var uri = url.parse(req.url).pathname;

    if (uri.startsWith (".")) {
        var i;
        for (i = 1; i < uri.length && uri.charAt(i) == '.'; i++) {
        }
        uri = uri.substring(i);
    }
    var filename = path.join(process.cwd() + "/" + FILE_ROOT, uri);
    var mimeTypes = {
        "html": "text/html",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "png": "image/png",
        "js": "text/javascript",
        "css": "text/css"};

    fs.exists(filename, function(exists) {
        if(!exists || !fs.lstatSync(filename).isFile ()) {
            console.log("not exists: " + filename);
            res.statusCode = 404;
            res.setHeader ('Content-Type', 'text/plain');
            res.end (uri + ' not found');
            return;
        }
        var mimeType = mimeTypes[path.extname(filename).split(".")[1]];
        if (mimeType === undefined) {
            mimeType = "text/plain";
        }
        res.statusCode = 200;
        res.setHeader ('Content-Type', mimeType);

        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(res);

    });
}

function cloneQuote (quote) {
    var q = {
        id     : quote.id,
        quote  : quote.quote,
        author : quote.author,
        source : quote.source,
        notes  : quote.notes
    };
    return q;
}

function qotdResponse (res) {
    var n = randomInt (0, quotes.length);
    var quote = quotes[n];
    var resp = cloneQuote(quote);
    var imageGroup = findImageGroupById(quote.imageGroupId);
    var f = randomInt(0, imageGroup.images.length);

    resp.image_path = QUOTE_IMAGE_RELATIVE_PATH + imageGroup.images[f].path;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    templateEngine.expandTemplate (template, resp, (s) => {res.write(s);});
    res.end();
}

function singleQuoteResponse (res) {
    var n = randomInt (0, quotes.length);
    var quote = quotes[n];
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/json');
    res.end (JSON.stringify(quote));
}

server.listen(port, () => {
  console.log(`Server running at port:${port}/`);
});


function insertNewQuoteToDB (quote, then) {
    var db = new sqlite.Database (QUOTES_FILENAME);
    db.run ("INSERT INTO quotes VALUES (?,?,?,?,?,?,?)",
            quote.id, quote.quote, quote.author, quote.source, quote.createdOn, quote.notes, quote.imageGroupId,
            function (err) {
                db.close ();
                if (err) {
                    console.log ("Error adding quote: " + err.toString());
                }
                then (err !== null);
            });
}

function updateQuoteOnDB (quote, then) {
    var db = new sqlite.Database (QUOTES_FILENAME);
    db.run ("UPDATE quotes SET quote=?, author=?, source=?, notes=?, image_group=? WHERE id=?",
            quote.quote, quote.author, quote.source, quote.notes, quote.imageGroupId, quote.id,
            function (err) {
                db.close ();
                if (err) {
                    console.log ("Error adding quote: " + err.toString());
                }
                then (err !== null);
            });
}

function addQuoteRespose (body, res) {
    var inputQuote = qs.parse(body);
    res.statusCode = 200;
    res.setHeader ('Content-Type', 'text/plain');
    if ((inputQuote.quote === null) || (inputQuote.quote.trim() === "") ||
        (inputQuote.secret === null) || !checkSecret (inputQuote.secret)) {
            res.end ('Quote Added!');
    } else {
        var q = createQuoteObjFromInput (inputQuote);
        if (q.id === 0) {
            q.id = quotes[quotes.length - 1].id + 1;
            quotes.push(q);
            addToQuotesForSearch (q);
            insertNewQuoteToDB (q, function (wasError) {
                res.end (wasError ? "Error" : "Quote " + quotes.length + " added");
            });
        } else {
            var retObj = findQuoteById (q.id);
            if (retObj === null) {
                res.end ('Quote Added!');
                return;
            }
            quotes[retObj.index] = q;
            addToQuotesForSearch (q, retObj.index);
            updateQuoteOnDB (q, function (wasError) {
                res.end (wasError ? "Error" : "Quote " + q.id + " updated");
            });
        }
    }
}

function createQuoteObjFromInput (inputQuote) {
    var groupName = getMethodValue(inputQuote, "imageGroupName", "");
    var group = groupName == "" ? null : findImageGroupByName(groupName);
    var id = group == null ? DEFAULT_IMAGE_GROUP_ID : group.id;

    var quote = {
        id : Number(getMethodValue (inputQuote, "id", 0)),
        quote : getMethodValue (inputQuote, "quote", "Quote"),
        author : getMethodValue (inputQuote, "author", ""),
        source : getMethodValue (inputQuote, "source", ""),
        notes : getMethodValue (inputQuote, "notes", ""),
        imageGroupId : id
    };
    if (quote.id === 0) {
        var d = new Date();
        quote.createdOn = d.getDate () + "-" + (d.getMonth()+1) + "-" + (d.getYear() + 1900);
    }
    return quote;
}

function addGroupResponse (req, res) {
    var form = new mp.Form();

    res.statusCode = 200;
    res.setHeader ('Content-Type', 'text/plain');

    form.autoFiles = true;
    form.uploadDir = QUOTE_IMAGE_FULL_PATH;
    form.parse (req, function(err, fields, files) {
        if (err) {
            console.log(err);
        }
        addOrUpdateImageGroup(fields, files, (err, id) => {
            if (err) {
                res.end("Group Added");
            } else {
                if (id == imageGroups[imageGroups.length-1].id) {
                    res.end("Group " + id + " added");
                } else {
                    res.end("Group " + id + " updated");
                }
            }
        });
    });
}

function addOrUpdateImageGroup(fields, files, then) {

    var groupName = fields.groupName;
    var groupObj;
    var files = files.images === null ? [] : files.images;
    var urls = null;

    if (fields.imagesource == "url") {
        urls = fields.urls === null ? "" : fields.urls[0];
    }


    if (groupName === null || groupName[0] === "") {
        return addImage(true, db, files, urls, then);
    }
    groupName = groupName[0].toLowerCase ();
    if (fields.secret === null || !checkSecret (fields.secret[0])) {
        return addImage(true, null, null, files, urls, then);
    }

    var db = new sqlite.Database (QUOTES_FILENAME);

    // New group
    if (fields.id === null || fields.id[0] === "0") {
        groupObj = {
            id : imageGroups[imageGroups.length - 1].id + 1,
            name : groupName,
            images: []
        };

        db.run("INSERT INTO image_group VALUES(?,?)", groupObj.id, groupObj.name,
            function(err) {
                if (err !== null) {
                    console.log("Error adding image group: " + err.toString());
                    return addImage(true, db, groupObj, files, urls, then);
                } else {
                    imageGroups.push (groupObj);
                    return addImage(false, db, groupObj, files, urls, then);
                }
            });
    } else {
        fields.id = Number(fields.id[0]);
        groupObj = findImageGroupById (fields.id);
        if(groupObj === null) {
            return addImage(true, db, groupObj, files, urls, then);
        }
        if (groupName != groupObj.name) {
            db.run("UPDATE image_group SET name=? WHERE id=?", groupName, groupObj.id,
                    (err) => {
                        if (err) {
                            console.log("Failed to update image group name: " + err.toString());
                            return addImage(true, db, groupObj, files, urls, then);
                        } else {
                            groupObj.name = groupName;
                            return addImage(false, db, groupObj, files, urls, then);
                        }
                    });
        } else {
            return addImage(false, db, groupObj, files, urls, then);
        }
    }
}

function deleteDownloadFiles (files) {
    files.forEach((f) => {
        try {
            fs.unlinkSync(f.path);
        } catch (err) {
            console.log("Failed to delete " + f.path + ": " + err.toString());
        }
    });
}

function addImage(err, db, groupObj, files, urls, then) {

    if (err) {
        if (db) db.close();
        deleteDownloadFiles (files);
        return then(err);
    }

    if (urls !== null) {
        deleteDownloadFiles (files);
        return getImagesFromURL(db, groupObj, urls, then);
    }


    var count = groupObj.images.length + 1;
    var filename;
    var file_basename;

    function renameAndAddImageToDB (i) {
        if (i >= files.length) {
            db.close();
            then(false, groupObj.id);
            return;
        }
        var f = files[i];
        if (fs.lstatSync(f.path).size === 0) {
            try {
                fs.unlinkSync(f.path);
            } catch (err) {
                console.log("Failed to delete " + f.path + ": " + err.toString());
            }
        } else {
            file_basename = groupObj.name + "_" + count + path.extname(f.path);
            filename = QUOTE_IMAGE_FULL_PATH + file_basename;
            try {
                fs.renameSync(f.path, filename);
                ++count;
                db.run("INSERT INTO image VALUES(?,?)", groupObj.id, file_basename,
                        (err) => {
                            if (err != null) {
                                console.log("Failed to insert image: " + err.toString());
                            } else {
                                groupObj.images.push(file_basename);
                            }
                            renameAndAddImageToDB(i+1);
                        });
            } catch (err) {
                console.log("Failed to rename " + f.path + " :" + err.toString());
                try {
                    fs.unlinkSync(f.path);
                } catch (err) {
                    console.log("Failed to delete " + f.path + ": " + err.toString());
                }
            }
        }
    }

    renameAndAddImageToDB(0);
}

function getMethodValue (obj, method, defaultValue) {
    if ((obj[method] === undefined) || (obj[method] === null) ||
            (obj[method].trim () === "")) {
                return defaultValue;
    }
    return obj[method].trim();
}

function checkSecret (s) {
    const secret = "445a4564a6c921331a2864a31fdf252d785b6a87aefbef3d826ffa58ecb74482";
    return (crypto.createHmac ('sha256', s).digest('hex') === secret);
}

function searchQuoteResponse (url, res) {
    res.setHeader ('Content-Type', 'text/plain');
    res.statusCode = 200;
    var idx = url.indexOf ('?');
    if (idx == -1) {
        res.end ();
        return;
    }
    var obj = qs.parse (url.substr (idx+1, url.length-(idx+1)));
    if ((obj.s === null) || (obj.s === "")) {
        res.end ();
        return;
    }
    var searchObj = parseSearchTerm (obj.s);
    var filter = searchQuotes (searchObj);
    var result = [];
    for (var i = 0; i < quotes.length; i++) {
        if (filter[i]) {
            result.push (quotes[i]);
        }
    }
    res.end (JSON.stringify(result));
}

function isWordPart (ch) {
    return (((ch >= 'a') && (ch <= 'z'))
            || ((ch >= 'A') && (ch <= 'Z'))
            || ((ch >= '0') && (ch <= '9')));
}

function parseSearchTerm (str) {
    var idx;
    var ch;
    var wordStart = 0;
    var word;
    var state;
    var inQuotes;
    var andOperator = false;
    var operatorConsmed = true;
    var searchObj = {
        quote: [],
        author: [],
        source: [],
        notes: [],
        andOperator : [false, false, false, false],
    };

    const ST_QUOTE = 0;
    const ST_AUTHOR = 1;
    const ST_SOURCE = 2;
    const ST_NOTES = 3;
    const ST_ALL = 4;

    const PROP = ["quote", "author", "source", "notes"];

    state = ST_ALL;
    inQuotes = false;

    for (idx = 0; idx < str.length; idx++) {
        ch = str[idx];


        if (ch == '"') {
            word = str.substring (wordStart, idx);
            addSearchTerm (word);
            wordStart = idx+1;
            if (!inQuotes) {
                inQuotes = true;
            } else {
                inQuotes = false;
            }
            continue;
        }

        // Everything in quotes is considered a single word
        if (inQuotes) {
            continue;
        }

        if (!isWordPart (ch)) {
            word = str.substring (wordStart, idx);
            wordStart = idx+1;
            switch (ch) {
                case ':':
                    var propidx = PROP.indexOf(word);
                    if (propidx != -1) {
                        state = propidx;
                    }
                    if (!operatorConsmed) {
                        operatorConsmed = true;
                    } else {
                        andOperator = false;
                    }
                    break;
                case '&':
                    // And operator for the next term
                    andOperator = true;
                    operatorConsmed = false;
                    addSearchTerm (word);
                    break;
                case '|':
                    andOperator = false;
                    operatorConsmed = false;
                    addSearchTerm (word);
                    // Or operator
                    break;
                default:
                    // Just a separator - add another word to the current search term
                    addSearchTerm (word);
            }
        }
    }
    // Add last
    word = str.substring (wordStart, idx);
    addSearchTerm (word);
    return searchObj;

    function addSearchTerm (w) {
        var w2 = w.trim ();
        if (w2 !== "") {
            if (state == ST_ALL) {
                for (var p = 0; p < PROP.length; p++) {
                    searchObj[PROP[p]].push(w.toLowerCase());
                }
            } else {
                searchObj[PROP[state]].push(w.toLowerCase());
                if (andOperator) {
                    searchObj.andOperator[state] = true;
                }
            }
        }
    }
}

function searchQuotes (searchObj) {
    var filter = [];

    searchByMethod (filter, "quote", searchObj.quote, false);
    searchByMethod (filter, "author", searchObj.author, searchObj.andOperator[1]);
    searchByMethod (filter, "source", searchObj.source, searchObj.andOperator[2]);
    searchByMethod (filter, "notes", searchObj.notes, searchObj.andOperator[3]);
    return filter;
}

function searchByMethod (filter, method, searchTerms, andOperator) {

    var i, j;
    var quote;
    if (searchTerms.length === 0) return;

    if (!andOperator) {
        for (i = 0; i < quotesForSearch.length; i++) {
            if (filter[i]) continue;
            quote = quotesForSearch[i];
            for (j = 0; j < searchTerms.length; j++) {
                if (quote[method].indexOf(searchTerms[j]) != -1) {
                    filter[i] = true;
                    break;
                }
            }
        }
    } else {
        for (i = 0; i < quotesForSearch.length; i++) {
            if (!filter[i]) continue;
            quote = quotesForSearch[i];
            for (j = 0; j < searchTerms.length; j++) {
                if (quote[method].indexOf(searchTerms[j]) != -1) {
                    filter[i] = true;
                    break;
                }
            }
            if (j == searchTerms.length) {
                filter[i] = false;
            }
        }
    }
}

function editQuoteResponse (url, res) {
    const html_file = "editquote.html";
    var idx;
    var quote = {
        id: 0,
        quote: "",
        author: "",
        source: "",
        notes: ""
    };
    var html_tmpl = templateEngine.parseTemplate (fs.readFileSync (html_file).toString());

    res.setHeader ('Content-Type', 'text/html');
    res.statusCode = 200;

    if ((idx = url.indexOf ("?")) != -1) {
        var qsobj = qs.parse (url.substr (idx+1, url.length-(idx+1)));
        if ((qsobj.id !== null) && (qsobj.id !== "") && !isNaN(qsobj.id)) {
            var retObj = findQuoteById (Number(qsobj.id));
            if (retObj !== null) {
                quote = cloneQuote(retObj.quote);
                var imgGroup = findImageGroupById(retObj.quote.imageGroupId);
                quote.imageGroupName = imgGroup.name;
            }
        }
    }
    templateEngine.expandTemplate (html_tmpl, quote, (s) => {res.write(s);});
    res.end();
}

function editGroupResponse(url, res) {
    const html_file = "editgroup.html";
    var idx;
    var group = {
        id: 0,
        name: "",
    };
    var html_tmpl = templateEngine.parseTemplate (fs.readFileSync (html_file).toString());
    var retObj;

    res.setHeader ('Content-Type', 'text/html');
    res.statusCode = 200;

    if ((idx = url.indexOf ("?")) != -1) {
        var qsobj = qs.parse (url.substr (idx+1, url.length-(idx+1)));
        if (qsobj.id !== undefined) {
            if ((qsobj.id !== "") && !isNaN(qsobj.id)) {
                retObj = findImageGroupById (Number(qsobj.id));
                if (retObj !== null) {
                    group = retObj;
                }
            }
        } else if (qsobj.name !== null) {
            retObj = findImageGroupByName (qsobj.name);
            if (retObj !== null) {
                group = retObj;
            }
        }
    }
    templateEngine.expandTemplate (html_tmpl, group, (s) => {res.write(s);});
    res.end();
}

function findQuoteById (qid) {
    var retObj = {
        index: -1,
        quote: {}
    };

    if ((qid < quotes.length) && (quotes[qid].id === qid)) {
        retObj.index = qid;
        retObj.quote = quotes[qid];
    } else {
        for (var idx = 0; idx < quotes.length; ++idx) {
            if (quotes[idx].id === qid) {
                retObj.index = idx;
                retObj.quote = quotes[idx];
            }
        }
    }
    return retObj.index == -1 ? null : retObj;
}

function findImageGroupById (id) {
    if ((id < imageGroups.length) && (imageGroups[id].id == id)) {
        return imageGroups[id];
    }
    for (var idx = 0; idx < imageGroups.length; ++idx) {
        if (imageGroups[idx].id === id) {
            return imageGroups[idx];
        }
    }
    return null;
}

function getImagesFromURL (db, groupObj, urls_string, then) {
    var urls = urls_string.split(';');
    downloadImages (db, groupObj, urls, then);
}

function downloadImages (db, groupObj, urls, then) {

    downloadImage(0);

    function downloadImage (i) {
        if (i >= urls.length) {
            db.close();
            then(false, groupObj.id);
            return;
        }

        var data = [];
        var options = getRequestObj(urls[i]);
        var err = false;

        http.get(options, (resp) => {
            if (resp.statusCode != 200) {
                console.log("Error getting image " + urls[i] + ": " + resp.statusCode);
                return downloadImage (i+1);
            }

            resp.on('data', (chunk) => {
                data.push(chunk);
            })
            .on('error', (e) => {
                console.log("Error getting " + urls[i] + ": " + e.toString());
                err = true;
            }).
            on('end', () => {
                if (err) {
                    return downloadImage(i+1);
                }
                var buf = Buffer.concat(data);
                var ext = path.extname(options.pathname);
                if (ext === "") {
                    ext = getExtensionFromMimeType(resp.headers['content-type']);
                }
                var file_basename = groupObj.name + "_" + (groupObj.images.length+1) + ext;
                var filename = QUOTE_IMAGE_FULL_PATH + file_basename;
                fs.writeFileSync(filename, buf, {encoding: "binary"});
                console.log("Downloaded " + filename);
                db.run("INSERT INTO image VALUES(?,?)", groupObj.id, file_basename,
                    (err) => {
                        if (err != null) {
                            console.log("Failed to insert image: " + err.toString());
                        } else {
                            groupObj.images.push(file_basename);
                            downloadImage (i+1);
                        }
                    });
            });
        });
    }
}

function getExtensionFromMimeType (type) {
    var ext;
    switch(type) {
        case "image/jpeg":
            ext = ".jpg";
            break;
        case "image/png":
            ext = ".png";
            break;
        case "image/gif":
            ext = ".gif";
            break;
    }
    return ext;
}

function getRequestObj(imageUrl) {

    var obj = url.parse(imageUrl);
    var retObj;
    if (process.env["http_proxy"] === undefined) {
        retObj = obj;
    } else {
        var proxy = url.parse(process.env["http_proxy"]);
        retObj = {
            host: proxy.hostname,
            port: proxy.port,
            path: imageUrl,
            header: {
              host: obj.hostname
            },
            pathname:  obj.pathname
        };
    }
    return retObj;
}
function findImageGroupByName(name) {
    for(var i = 0; i < imageGroups.length; i++) {
        if (imageGroups[i].name == name) return imageGroups[i];
    }
    return null;
}

function logMessage (msg) {
    var d = new Date();
    console.log ("[" + d.getDate () + "-" + (d.getMonth()+1) + "-" + (d.getYear() + 1900) + " " +
            d.getHours () + ":" + d.getMinutes() + ":" + d.getSeconds() + "." + d.getMilliseconds () + "]: " + msg);
}

