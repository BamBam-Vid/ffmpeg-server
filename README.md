# ffmpeg-server

Express server with TypeScript for ffmpeg processing, built with modern best practices.

## Prerequisites

- Node.js v24.11.1 (see [.nvmrc](./.nvmrc))
- pnpm 10.1.0
- [Gitleaks](https://github.com/gitleaks/gitleaks) (optional, for secret detection)

## Quick Start

### 1. Install Node.js version

```bash
nvm install
nvm use
```

### 2. Install pnpm

```bash
corepack enable
corepack prepare pnpm@10.1.0 --activate
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Create environment file

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 5. Run development server

```bash
pnpm dev
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## Available Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm build` - Build TypeScript to JavaScript (runs lint first)
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Tech Stack

- **Runtime**: Node.js v24.11.1
- **Language**: TypeScript 5.8+ with strict mode
- **Framework**: Express 5.x
- **Package Manager**: pnpm 10.1.0
- **Code Quality**: ESLint 9+ (flat config), Prettier
- **Git Hooks**: Husky 9
- **Security**: Gitleaks for secret detection

## Project Structure

```
ffmpeg-server/
├── .husky/              # Git hooks
│   ├── pre-commit       # Runs ESLint + Gitleaks
│   └── pre-push         # Runs build
├── .vscode/             # VSCode configuration
│   ├── settings.json    # Editor settings
│   └── launch.json      # Debug configuration
├── src/                 # TypeScript source files
│   └── index.ts         # Server entry point
├── dist/                # Compiled JavaScript (gitignored)
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── eslint.config.js     # ESLint flat config
├── .prettierrc          # Prettier configuration
├── .nvmrc               # Node version
├── Dockerfile           # Multi-stage Docker build
└── .dockerignore        # Docker ignore patterns
```

## TypeScript Configuration

This project follows [Total TypeScript best practices](https://www.totaltypescript.com/tsconfig-cheat-sheet):

- ✅ `strict` mode enabled
- ✅ `noUncheckedIndexedAccess` for safer array/object access
- ✅ `noImplicitOverride` for explicit overrides
- ✅ `verbatimModuleSyntax` for explicit type imports
- ✅ `isolatedModules` for better tooling compatibility
- ✅ ES Modules (`"type": "module"`)
- ✅ `NodeNext` module resolution

## Git Hooks

### Pre-commit
- Runs ESLint on all files
- Runs Gitleaks on staged files to detect secrets

### Pre-push
- Runs full build to ensure TypeScript compiles

## Docker

### Build Image

```bash
docker build -t ffmpeg-server:latest .
```

### Run Container

```bash
docker run -p 3000:3000 -e PORT=3000 ffmpeg-server:latest
```

### Push to Docker Hub

```bash
# Tag the image
docker tag ffmpeg-server:latest yourusername/ffmpeg-server:latest

# Push to Docker Hub
docker push yourusername/ffmpeg-server:latest
```

## VSCode Integration

This project includes VSCode configuration for:

- **Format on Save** with Prettier
- **ESLint auto-fix** on save
- **Debug Configuration** (F5 to start debugging)

## Security

- Gitleaks is configured to scan for secrets before commits
- `.env` files are gitignored
- Install gitleaks: `brew install gitleaks` (macOS)

## Environment Variables

Create a `.env` file in the root directory:

```env
PORT=3000
NODE_ENV=development
```

## API Endpoints

- `GET /` - Root endpoint
- `GET /health` - Health check endpoint

## Development

1. The development server uses `nodemon` with `tsx` for hot reload
2. TypeScript files are in `src/`, compiled output goes to `dist/`
3. Use the VSCode debugger (F5) for debugging

## Production

```bash
# Build the project
pnpm build

# Start production server
pnpm start
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Ensure `pnpm build` passes
4. Commit your changes (pre-commit hooks will run)
5. Push your branch (pre-push hooks will run)

## License

ISC
