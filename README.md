# Library Management System

A professional, dependency-free Java 17 console application for managing books, members, checkouts, returns, and overdue loans.

The project also includes a browser-based Libris dashboard in `index.html`, styled with `styles.css` and powered by `app.js`. The browser version is fully interactive and stores its demo data in `localStorage`.

## Features

- Persistent local storage in `library-data/`
- Add, list, search, and remove books
- Register, list, and remove members
- Check books out and return them
- Automatic due dates and overdue reporting
- Input validation and clear operational messages
- Seeded sample records on first launch

## Requirements

- JDK 17 or newer

## Run

### Browser dashboard

Open `index.html` directly in a browser, or serve the folder locally:

```powershell
python -m http.server 8080
```

Then visit `http://localhost:8080`.

The dashboard supports catalog search, member registration, book creation, checkout, returns, loan filters, and resettable sample data.

### Java console application

From the project root:

```powershell
javac -d out (Get-ChildItem -Recurse -Filter *.java src\main\java).FullName
java -cp out com.library.App
```

On macOS/Linux:

```bash
javac -d out $(find src/main/java -name '*.java')
java -cp out com.library.App
```

The application creates `library-data/` automatically. Delete that folder to reset the application to its initial sample data.

## Data files

- `books.dat`
- `members.dat`
- `loans.dat`

Records use a tab-separated text format and are intentionally human-readable.
