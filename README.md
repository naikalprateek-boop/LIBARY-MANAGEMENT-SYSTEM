# Library Management System

A library management project with a Java 17 console application and a full-stack Libris web application powered by Node.js, Express, and SQLite.

## Features

- Persistent SQLite storage in `library-data/libris.sqlite`
- Add, list, search, and remove books
- Register, edit, search, and remove members
- Edit and manage books
- Check books out and return them
- Automatic due dates, overdue reporting, and monthly checkout trends
- Popular-title reports and CSV exports for books, members, and loans
- Administrator and librarian roles
- Hashed passwords, database-backed sessions, CSRF checks, and login rate limiting
- Parameterized database operations and validated inputs

## Requirements

- Node.js 20 or newer and npm (web application)
- JDK 17 or newer (Java console application)

## Run

### Full-stack web application

Install dependencies from the project root:

```sh
npm install
```

Create a local environment file in PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` before starting. Set a unique `ADMIN_EMAIL`, an administrator password of at least 12 characters and no more than 72 UTF-8 bytes, and a random `SESSION_SECRET` of at least 32 characters. Do not use the placeholder values or commit `.env`.

Start Libris:

```sh
npm start
```

Open `http://localhost:3000` and sign in with the configured administrator credentials. The database and first administrator account are created automatically on first startup. The administrator can create librarian or additional administrator accounts in Team access.

The web app supports catalog and member editing, checkout and returns, reports, search, and authenticated CSV exports. Records with loan history cannot be deleted so reports remain consistent.

Before public deployment, configure HTTPS, plan database backups and account recovery, and add automated tests and operational monitoring.

### Browser-only dashboard

The original browser-only app remains in the project root (`index.html`, `styles.css`, and `app.js`). It stores data in `localStorage` and can be opened directly for the original demo.

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
