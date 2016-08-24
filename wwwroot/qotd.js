const NEWQUOTE_URL = "singlequote";

document.addEventListener ("DOMContentLoaded", function (event) {
    document.querySelector ("#refresh").onclick = onRefreshClicked;
});

function onRefreshClicked () {
    document.querySelector ("#refresh").onclick = null;
    changeRefreshButton (true);
    refreshQuote ();
}

function changeRefreshButton (isRefreshInProgress) {
    var image;
    if (isRefreshInProgress) {
        document.querySelector ("#refresh").className = "refresh-in-progress";
    } else {
        document.querySelector ("#refresh").className = "refresh";
    }
}

function refreshQuote () {

    var req = new window.XMLHttpRequest ();
    req.onreadystatechange = function (){
        updateQuote (req);
    }
    req.open ("GET", NEWQUOTE_URL, true);
    req.send (null);
}

function updateQuote (request) {
    if ((request.readyState == 4) && (request.status == 200)) {
        var obj = JSON.parse (request.responseText);
        document.querySelector(".quote").textContent = obj.quote;
        document.querySelector(".author").textContent = obj.author;
        document.querySelector("h3").textContent = "#" + obj.id;
        document.querySelector("#source").textContent = "From: " + obj.source;
        document.querySelector("#addedOn").textContent = "Added On" + obj.createdOn;
        document.querySelector("#notes").textContent = obj.notes;
        changeRefreshButton (false);
        document.querySelector("#refresh").onclick = onRefreshClicked;
    }
}
