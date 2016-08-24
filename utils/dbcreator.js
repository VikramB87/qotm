/*
 * Usage
 * dbcreator --nocreate --noimport <quotes_file>
 */
var fs = require('fs');
var assert = require ('assert');
var sqlite = require('sqlite3').verbose();
var file = "thoughts.db";
const lineReader = require ('readline');
var nocreate = false;
var noimport = false;
var importFile = null;
var exists = false;
var lastid = 0;
var quotes = [];
var done = false;

const OPT_NOCREATE = "--nocreate";
const OPT_NOIMPORT = "--noimport";

if ((process.argv.length < 3) || (process.argv.length > 5)) {
    console.log ("Incorrect command line.");
    printUsageAndExit ();
}

for (i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === OPT_NOCREATE) {
        nocreate = true;
    } else if (process.argv[i] === OPT_NOIMPORT) {
        noimport = true;
    } else {
        importFile = process.argv[i];
    }
}

if (importFile == null) {
    console.log("Import file not specified!");
    printUsageAndExit ();
}

if (!noimport && !fs.existsSync (importFile)) {
    console.log ("Import file " + importFile + "does not exist!");
    process.exit(1);
}

if (fs.existsSync (file)) {
    exists = true;
} else {
    if (nocreate) {
        console.log ("Database file " + file + " does not exist!");
        process.exit(1);
    }
}

var db = new sqlite.Database (file);
db.serialize ();

function loadOrCreateDB () {

    if (!exists) {
        db.run("CREATE TABLE quotes (\
            id INT PRIMARY KEY,\
            quote TEXT NOT NULL,\
            author VARCHAR(128),\
            source VARCHAR(128),\
            createdOn DATE,\
            notes TEXT)",
                function (err) {
                    if (err != null) {
                        console.log ("Error in DB Creation: " + err.toString());
                        process.exit(1);
                    } else {
                        console.log ("DB Created");
                        importQuotes ();
                    }
                });

    } else {
        db.all ("SELECT max(id) FROM quotes", function (err, rows) {
            if (err != null) {
                console.log ("Couldn't query quotes DB in " + file + ": " + err.toString ());
                process.exit(1);
            }
            assert(rows.length == 1);
            lastid = rows[0]["max(id)"];
            if (lastid == null) {
                lastid = 0;
            }
            console.log("DB already exists. Found " + lastid + " quotes.");
            importQuotes();
        });
    }

}

loadOrCreateDB ();
console.log ("Reading quotes from " + importFile + "...");

function importQuotes () {
    var linereader = lineReader.createInterface ({
        input: fs.createReadStream (importFile)
    });
    linereader.on ('line', function (line) {
        addQuoteToArray (line);
    });
    linereader.on('close', function () {
        if (done) {
            console.log("already done, returning..");
            return;
        }
        done = true;
        console.log ("Read " + quotes.length + " lines.");
        console.log ("Importing into database...");
        insertQuotesToDB ();
    });
}

function parseQuote (line) {

    line = line.trim();
    if (line.startsWith ('-')) {
        var idx = 1;
        while (line.charAt(idx) == ' ') {
            idx++;
        }
        line = line.slice (idx, line.length);
    }

    var q = line.lastIndexOf ('"');
    var h = line.lastIndexOf ('-');
    if (h > q) {
        author = line.slice (h+1, line.length);
        line = line.slice (0, h);
    } else {
        author = "";
    }

    quote = {
        quote : line,
        author: author
    };
    return quote;
}

function addQuoteToArray (line) {
    var q = parseQuote (line);
    quotes.push (q);
}

function insertQuotesToDB () {
    insertQuote (0);
}

function insertQuote (idx) {
    db.run ("INSERT INTO quotes VALUES (?,?,?,?,'','')",
            lastid+1, quotes[idx].quote, quotes[idx].author, "Original Text File",
            function (err) {
                if (err == null) {
                    console.log ("Inserted quote with id " + lastid);
                    lastid++;
                } else {
                    console.log ("Failed to insert quote: " + err.toString());
                }
                if ((idx+1) >= quotes.length) {
                    console.log (idx);
                    db.close ();
                    return;
                }
                insertQuote (idx+1);
            });
}


function printUsage () {
    console.log ("Usage: dbcreator [--nocreate] [--noimport] <quotes-file>");
}

function printUsageAndExit () {
    printUsage ();
    process.exit(1);
}

