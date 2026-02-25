# 🎓 LFA - Lernzentrum für Auszubildende Learning Platform

A comprehensive, role-based learning management system designed for German vocational training in software development. Built with modern web technologies and following enterprise-grade development standards.

## 🚀 Features

### **Role-Based Access Control (RBAC)**

- **Trainee (Auszubildende)**: Access to learning modules, lessons, quizzes, and progress tracking
- **Trainer (Ausbilder)**: Content management, trainee oversight, analytics, and assessment tools
- **Secure Authentication**: Role validation and route protection

### **Learning Management**

- **Modular Learning Paths**: Structured curriculum with progressive difficulty levels
- **Interactive Lessons**: Rich content with multimedia support
- **Assessment System**: Comprehensive quizzes and progress tracking
- **Knowledge Submission**: Built-in knowledge submission tools

### **Professional Dashboard**

- **Real-time Analytics**: Progress visualization with charts and statistics
- **Performance Tracking**: Detailed metrics and learning outcomes
- **Modern UI/UX**: Glassmorphism design with dark theme
- **Responsive Design**: Mobile-first approach for all devices

### **Content Management**

- **Dynamic Content**: Easy-to-update learning materials
- **Quiz Management**: Create, edit, and manage assessments
- **Trainee Oversight**: Monitor individual and group progress
- **Acceptance Protocols**: Formal assessment and certification tools

## 🛠️ Tech Stack

### **Frontend Framework**

- **Next.js 15.4.6**: Latest App Router with React 18
- **TypeScript**: Full type safety and IntelliSense
- **Tailwind CSS 4.1.12**: Latest utility-first CSS framework

### **UI Components**

- **Shadcn UI**: Professional component library
- **Lucide React**: Modern icon system
- **Recharts**: Data visualization and analytics charts

### **State Management**

- **React Context**: Authentication and language management
- **Custom Hooks**: Reusable business logic

### **Styling & Theming**

- **CSS Variables**: Dynamic theme system
- **Glassmorphism**: Modern visual effects
- **Responsive Design**: Mobile-first approach

## ⚡ Performance Optimizations

### **React Performance**

- **React.memo**: Component memoization to prevent unnecessary re-renders
- **useMemo**: Expensive computation caching
- **useCallback**: Stable function references
- **Lazy Loading**: Code splitting and dynamic imports

### **CSS Performance**

- **Hardware Acceleration**: GPU-accelerated animations with `transform: translateZ(0)`
- **Reduced Motion**: Respects user preferences for motion sensitivity
- **Optimized Blur**: Balanced backdrop-filter values for smooth performance
- **Efficient Transitions**: Cubic-bezier easing functions for natural feel

### **Next.js Optimizations**

- **App Router**: Modern routing with improved performance
- **Server Components**: Reduced client-side JavaScript
- **Prefetching**: Intelligent link preloading
- **Build Optimization**: Tree shaking and code splitting

## 📁 Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── trainee/                  # Trainee-specific routes
│   │   ├── layout.tsx           # Trainee layout with role validation
│   │   ├── dashboard/            # Trainee dashboard
│   │   ├── profile/              # User profile management
│   │   ├── knowledge-submission/ # Knowledge assessment
│   │   ├── modules/              # Learning modules overview
│   │   ├── lessons/              # Individual lessons
│   │   └── quizzes/              # Assessment tools
│   ├── trainer/                  # Trainer-specific routes
│   │   ├── layout.tsx           # Trainer layout with role validation
│   │   ├── dashboard/            # Trainer dashboard
│   │   ├── profile/              # User profile management
│   │   ├── content-management/   # Learning content administration
│   │   ├── quiz-management/      # Assessment administration
│   │   ├── trainees/             # Trainee oversight
│   │   ├── acceptance-protocol/  # Certification tools
│   │   └── analytics/            # Performance analytics
│   ├── login/                    # Authentication
│   ├── globals.css               # Global styles and theme
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
├── components/                    # Reusable UI components
│   ├── auth/                     # Authentication components
│   ├── dashboard/                 # Dashboard-specific components
│   ├── layout/                    # Layout components
│   ├── learning/                  # Learning content components
│   ├── trainer/                   # Trainer-specific components
│   ├── ui/                        # Base UI components
│   └── contexts/                  # React context providers
├── lib/                          # Utility libraries
│   ├── supabase.ts               # Mock data and API
│   └── types/                    # TypeScript type definitions
├── middleware.ts                 # Route protection middleware
└── contexts/                     # React context providers
    ├── AuthContext.tsx           # Authentication state
    └── LanguageContext.tsx       # Internationalization
```

## 🎨 Design System

### **High-Contrast Gaming Theme - Crimson & Onyx**

- **Primary Background**: Deep charcoal with radial gradient (#0a0a0a → #3a0a0a)
- **Accent Color**: Vibrant crimson red (#ff1a1a) for all interactive elements
- **Text Colors**: Crisp white (#ffffff) for primary, muted gray (#6b7280) for secondary
- **Border System**: Enhanced visibility with #333333 borders
- **Glass Effects**: Modern glassmorphism with backdrop blur and subtle shadows

### **Theme Features**

- **Radial Gradient Background**: Black on top-right transitioning to red tint
- **Animated Elements**: Subtle particle effects and background pulse
- **Hover Animations**: Smooth transitions with transform effects
- **Performance Optimized**: Hardware acceleration and reduced motion support

### **Visual Elements**

- **Glassmorphism**: Translucent, frosted glass effects
- **Gradients**: Smooth color transitions
- **Shadows**: Subtle depth and layering
- **Rounded Corners**: Modern, friendly interface

### **Typography**

- **Font Family**: System fonts with fallbacks
- **Hierarchy**: Clear heading and text structure
- **Readability**: Optimized contrast and spacing

## 🔐 Authentication & Security

### **Role-Based Access Control**

- **Trainee Routes**: `/trainee/*` - Learning and assessment tools
- **Trainer Routes**: `/trainer/*` - Administration and oversight
- **Route Protection**: Middleware-based security
- **Session Management**: Persistent authentication state

### **Security Features**

- **Route Validation**: Automatic role checking
- **Access Control**: Unauthorized access prevention
- **Session Security**: Secure authentication flow

## 📊 Data Visualization

### **Charts & Analytics**

- **Progress Tracking**: Real-time learning progress
- **Performance Metrics**: Individual and group statistics
- **Interactive Charts**: Responsive data visualization
- **Export Capabilities**: Data analysis and reporting

### **Dashboard Features**

- **Overview Cards**: Key performance indicators
- **Progress Bars**: Visual progress representation
- **Statistical Charts**: Comprehensive data analysis
- **Real-time Updates**: Live data synchronization

## 🌍 Internationalization

### **Language Support**

- **German (Primary)**: Full localization for German users
- **English (Secondary)**: International accessibility
- **Context Switching**: Dynamic language selection
- **Cultural Adaptation**: German vocational training context

## 🚀 Getting Started

### **Prerequisites**

- **Node.js**: Version 18.0 or higher
- **npm/yarn**: Package manager
- **Git**: Version control

### **Installation**

1. **Clone the repository**

   ```bash
   git clone https://github.com/Wamocon/Wamocon_FIAE.git
   cd fiae-learning-platform
   ```

2. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

3. **Environment setup**

   ```bash
   cp .env.example .env.local
   # Configure your environment variables
   ```

4. **Start development server**

   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open your browser**
   ```
   http://localhost:3000
   ```

## 🗄️ Database & Seeding

This project uses Drizzle ORM with Postgres (Supabase). To create tables and populate mock data:

1. Configure your database connection in `.env.local` (see `.env.example`):

   ```bash
   DB_CONNECTION_STRING=postgres://USER:PASSWORD@HOST:5432/DATABASE
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

2. Push the schema to the database:

   ```bash
   npm run migrate:push
   ```

3. Seed mock data:

   ```bash
   npm run db:seed
   ```

After seeding, connect your frontend to Supabase; you should see real data rendered from the backend.

### **Build for Production**

```bash
# Build the application
npm run build

# Start production server
npm start

# Export static files
npm run export
```

## 🧪 Testing

### **Test Commands**

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e
```

### **Testing Strategy**

- **Unit Tests**: Component and function testing
- **Integration Tests**: API and data flow testing
- **E2E Tests**: User journey validation
- **Accessibility Tests**: WCAG compliance checking

## 📦 Deployment

### **Platform Options**

- **Vercel**: Recommended for Next.js applications

- **Docker**: Containerized deployment

### **Environment Variables**

```bash
# Required
NEXT_PUBLIC_APP_URL=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# Optional
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

### 🐳 Run with Docker (simple, uses Supabase CLI)

This setup uses the Supabase CLI running on your host machine for the database and auth. The Docker container only runs the Next.js app, waits for the DB, applies Drizzle migrations, and starts.

1. Start local Supabase (host). In a separate terminal at the repo root:
   - Install the Supabase CLI if you don't have it yet: https://supabase.com/docs/guides/cli
   - Start services:
     - PowerShell: `supabase start`
   - This exposes:
     - REST/Auth/Realtime: http://127.0.0.1:54321
     - Postgres: 127.0.0.1:54322 (user postgres / password postgres / db postgres)

2. Configure env (optional). `.env` is already present with defaults for the CLI on Windows. If needed, verify:

   ```properties
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...anon key...
   DB_CONNECTION_STRING=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   ```

   Note: Inside Docker, these automatically map to `host.docker.internal` so you don't need to change them for containers.

3. Build and start the app container:
   - PowerShell: `docker compose up --build`

4. Open the app:
   - http://localhost:3000

What happens under the hood:

- The container converts the entrypoint script to LF, waits for the DB using `scripts/wait-for-db.mjs`, runs `npm run migrate:push` (Drizzle), then `next start`.
- Environment vars are taken from `.env` and/or docker-compose defaults.

To seed data after first run, you can exec into the container and run `npm run db:seed`.

To stop:

- `docker compose down` (app only)
- `supabase stop` (local Supabase services)

### **Build Optimization**

- **Code Splitting**: Automatic route-based splitting
- **Image Optimization**: Next.js image optimization
- **Bundle Analysis**: Webpack bundle analyzer
- **Performance Monitoring**: Core Web Vitals tracking

## 🔧 Development

### **Code Standards**

- **ESLint**: Code quality and consistency
- **Prettier**: Code formatting
- **TypeScript**: Type safety and IntelliSense
- **Husky**: Git hooks for quality assurance

### **Development Workflow**

1. **Feature Branch**: Create feature branch from main
2. **Development**: Implement features with tests
3. **Code Review**: Submit pull request for review
4. **Testing**: Automated and manual testing
5. **Deployment**: Merge to main and deploy

### **Code Quality**

- **Linting**: ESLint with strict rules
- **Formatting**: Prettier for consistent style
- **Type Checking**: TypeScript strict mode
- **Testing**: Comprehensive test coverage

## 📚 API Documentation

### **Mock Data Structure**

```typescript
interface Module {
  id: string;
  title: string;
  description: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  progress: number;
  estimatedTime: string;
  chapters: Chapter[];
  lessons: Lesson[];
}

interface Trainee {
  id: string;
  name: string;
  avatar: string;
  progress: number;
  role: 'trainee';
}
```

### **Authentication Endpoints**

- `POST /api/auth/login` - User authentication
- `POST /api/auth/logout` - User logout
- `GET /api/auth/profile` - User profile data

## 🤝 Contributing

### **Contribution Guidelines**

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit changes**: `git commit -m 'Add amazing feature'`
4. **Push to branch**: `git push origin feature/amazing-feature`
5. **Open pull request**: Submit for review

### **Development Setup**

```bash
# Install development dependencies
npm install --save-dev

# Setup pre-commit hooks
npm run prepare

# Run development server
npm run dev
```

### **Code Review Process**

- **Automated Checks**: Linting, testing, and type checking
- **Manual Review**: Code quality and security review
- **Testing**: Functional and regression testing
- **Documentation**: Update relevant documentation

---

**Built with ❤️ for German vocational training excellence**

_This project follows enterprise-grade development standards and is designed for professional use in educational institutions and corporate training environments._
