A simple quote server in nodejs I wrote to learn JavaScript, CSS, HTML and nodejs.
Uses bare nodejs (doesn't use express, etc). Uses the SQLite3 database.

Uses a simple template engine to generate pages.

Functionality:
    - /qotd (also default): Generates a random quote.
    - /search.html: Search for a quote
    - /editquote[?id=<quote_id>] : Add a new quote or edit an existing quote.
