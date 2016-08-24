'use strict';

const http = require('http');
const url  = require('url');
const fs = require('fs');
const path = require('path');
const templateEngine = require('./template_engine');
const sqlite = require('sqlite3').verbose();
const qs = require('querystring');
const crypto = require('crypto');

const port = 8000;
const template_filename = 'qotd.html';
const quotes_filename = 'thoughts.db';

var quotes = [];
var quotesForSearch = [];
function loadQuotes () {
    var db = new sqlite.Database (quotes_filename);
    db.all ("SELECT * FROM quotes ORDER BY id", function (err, rows) {
        if (err !== null) {
            console.log ("Error querying quotes from DB: " + err.toString ());
        } else {
            var i;
            for (i = 0 ; i < rows.length; i++) {
                addQuote (rows[i]);
            }
            console.log ("Loaded " + rows.length + " quotes");
            db.close ();
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
        notes: row.notes
    };
    quotes.push(q);
    addToQuotesForSearch (q);
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
const server = http.createServer(http_handler);

fs.watch (template_filename, function (curr, prev) {
    template = templateEngine.parseTemplate (fs.readFileSync (template_filename).toString ());
});

function http_handler (req, res) {
    var method = req.method;
    var body = "";

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
    var filename = path.join(process.cwd() + "/wwwroot", uri);
    var mimeTypes = {
        "html": "text/html",
        "jpeg": "image/jpeg",
        "jpg": "image/jpeg",
        "png": "image/png",
        "js": "text/javascript",
        "css": "text/css"};

    fs.exists(filename, function(exists) {
        if(!exists) {
            console.log("not exists: " + filename);
            res.statusCode = 404;
            res.setHeader ('Content-Type', 'text/plain');
            res.end (uri + ' not found');
            return;
        }
        var mimeType = mimeTypes[path.extname(filename).split(".")[1]];
        res.writeHead(200, mimeType);

        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(res);

    }); //end path.exists
}

function qotdResponse (res) {
    var n = randomInt (0, quotes.length);
    var f = randomInt (0, 20);
    var quote = quotes[n];
    var img = "'images/Background-" + f + ".jpg'";
    quote.image_path = img;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    templateEngine.expandTemplate (template, quote, (s) => {res.write(s);});
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


function printObject (obj) {
    for (var param in obj) {
        var value = obj[param];
        if (typeof value === 'object') {
            console.log (param + ':');
            printObject (value);
        } else {
            console.log (param + ' : ' + obj[param]);
        }
    }
}

function insertNewQuoteToDB (quote, then) {
    var db = new sqlite.Database (quotes_filename);
    db.run ("INSERT INTO quotes VALUES (?,?,?,?,?,?)",
            quote.id, quote.quote, quote.author, quote.source, quote.createdOn, quote.notes,
            function (err) {
                db.close ();
                if (err) {
                    console.log ("Error adding quote: " + err.toString());
                }
                then (err !== null);
            });
}

function updateQuoteOnDB (quote, then) {
    var db = new sqlite.Database (quotes_filename);
    db.run ("UPDATE quotes SET quote=?, author=?, source=?, notes=? WHERE id=?",
            quote.quote, quote.author, quote.source, quote.notes, quote.id,
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
        if (q.id == 0) {
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
    var quote = {
        id : Number(getMethodValue (inputQuote, "id", 0)),
        quote : getMethodValue (inputQuote, "quote", "Quote"),
        author : getMethodValue (inputQuote, "author", ""),
        source : getMethodValue (inputQuote, "source", ""),
        notes : getMethodValue (inputQuote, "notes", ""),
    };
    if (quote.id == 0) {
        var d = new Date();
        quote.createdOn = d.getDate () + "-" + (d.getMonth()+1) + "-" + (d.getYear() + 1900);
    }
    return quote;
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

    var match = false;
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
    var qid;
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
            if (retObj != null) {
                quote = retObj.quote;
            }
        }
    }
    templateEngine.expandTemplate (html_tmpl, quote, (s) => {res.write(s);});
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

