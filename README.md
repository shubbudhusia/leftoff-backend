# LeftOff

> Pick up exactly where you left off.

LeftOff is a browser productivity tool designed to remember where you stopped while browsing, helping you return to your previous progress without manually keeping track of it.

This repository contains the backend infrastructure for LeftOff, including authentication, data synchronization, trial management, payments, email services, and supporting APIs.

## Why LeftOff?

Browsers are good at remembering which pages you visited, but not necessarily where you stopped.

LeftOff is built around a simple idea:

**Your browsing progress should follow you automatically.**

Instead of relying on bookmarks, open tabs, or manually remembering where you stopped, LeftOff provides infrastructure for storing and synchronizing browsing progress across sessions.

## Features

The backend currently supports:

- User authentication
- Browser data synchronization
- Progress and user data storage
- Device and trial management
- Payment and subscription infrastructure
- Payment webhook handling
- Email delivery
- Public landing and policy pages
- REST API endpoints
- Environment-based configuration

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | Backend runtime |
| Express.js | API and server framework |
| Supabase | Database and backend services |
| Razorpay | Payment processing |
| Stripe | Payment infrastructure |
| Nodemailer | Transactional email |
| Render | Backend deployment |

The project currently targets **Node.js 22.x**.

## Project Structure

```text
leftoff-backend/
├── config/                 # Application configuration
├── controllers/            # Request and business logic
├── middleware/             # Express middleware
├── migrations/             # Database migrations
├── public/                 # Public website and policy pages
├── routes/                 # API route definitions
├── services/               # Backend services
├── .env.example            # Example environment configuration
├── .gitignore              # Files excluded from Git
├── api-routes.js           # Main API routes
├── database-setup.sql      # Database setup
├── server.js               # Express application entry point
├── trial-devices-setup.sql # Trial/device database setup
└── package.json
```

## Getting Started

### Prerequisites

Before running LeftOff locally, make sure you have:

- Node.js 22.x
- npm
- A Supabase project
- Required credentials for any external services you want to enable

### Clone the Repository

```bash
git clone https://github.com/shubbudhusia/leftoff-backend.git
cd leftoff-backend
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Then add your own credentials and configuration values to `.env`.

**Never commit production credentials, passwords, API keys, or other secrets to GitHub.**

### Database Setup

Database setup scripts are included in the repository:

```text
database-setup.sql
trial-devices-setup.sql
```

Review the SQL files before running them against your Supabase database.

### Run the Server

```bash
npm start
```

The application uses port `3001` by default unless another `PORT` environment variable is provided.

## API Status

You can verify that the backend is running using:

```text
GET /api/status
```

Example response:

```json
{
  "success": true,
  "status": "LeftOff Backend Running"
}
```

## Core API Areas

### Authentication

```text
/api/auth
```

Handles authentication-related functionality for LeftOff users.

### Synchronization

```text
/api/sync
```

Responsible for synchronizing LeftOff data between the client and backend.

### Trial Management

```text
/api/trial
```

Handles trial access and associated device state.

### Payments

The project includes payment and subscription infrastructure for handling paid plans and account access.

Payment-related events are processed server-side so relevant events can be validated before account or subscription state is updated.

## Architecture

```text
Browser / LeftOff Client
          │
          ▼
       REST API
          │
          ▼
    Express Backend
      │    │    │
      │    │    └──── Payment Services
      │    │
      │    └───────── Authentication
      │
      └────────────── Supabase
          │
          ▼
     Persistent Data
```

The backend acts as the central layer between the LeftOff client, persistent storage, authentication, payments, and supporting services.

## Security

Credentials and sensitive configuration should be stored using environment variables and should never be committed to the repository.

Payment webhook endpoints should validate incoming requests before modifying payment or subscription state.

The application also supports deployment environments operating behind a reverse proxy.

If you discover a security issue, please avoid publishing sensitive exploit details in a public issue.

## Development

LeftOff is currently maintained independently and is under active development.

Current areas of development include:

- Improving synchronization reliability
- Expanding automated testing
- Improving API documentation
- Strengthening authentication and security
- Improving subscription management
- Improving error handling
- Simplifying local development
- Making the project easier for external contributors

## Roadmap

- [ ] Expand automated test coverage
- [ ] Improve API documentation
- [ ] Add contributor documentation
- [ ] Improve synchronization architecture
- [ ] Improve error reporting and logging
- [ ] Expand security testing
- [ ] Improve developer setup
- [ ] Add CI/CD checks
- [ ] Improve cross-device synchronization
- [ ] Continue expanding the LeftOff ecosystem

The roadmap may change as the project evolves.

## Contributing

Contributions are welcome.

### How to Contribute

1. Fork the repository.
2. Create a new branch:

```bash
git checkout -b feature/your-feature
```

3. Make your changes.
4. Test your changes.
5. Commit your work:

```bash
git commit -m "Add your feature"
```

6. Push your branch:

```bash
git push origin feature/your-feature
```

7. Open a Pull Request.

For larger changes, consider opening an issue first so the proposed implementation can be discussed.

### Good First Contributions

Useful areas for contributions include:

- Documentation
- Tests
- API documentation
- Error handling
- Developer tooling
- Code cleanup
- Bug reports and reproduction cases

## Reporting Bugs

When reporting a bug, please include:

- What happened
- What you expected to happen
- Steps to reproduce the problem
- Browser or environment information where relevant
- Relevant logs with secrets and personal information removed

Never include API keys, passwords, access tokens, payment credentials, or other sensitive information in an issue.

## License

This project uses the **ISC License**.

A dedicated `LICENSE` file is included separately in the repository.

## Maintainer

**Shubham Dhusia**

GitHub: [@shubbudhusia](https://github.com/shubbudhusia)

## Project Status

LeftOff is under active development.

APIs, architecture, and functionality may change as development continues.

If you find LeftOff useful or want to contribute, consider starring the repository, opening an issue, or submitting a pull request.

---

Built to make returning to your work a little easier.
