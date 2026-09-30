import React, { useState } from 'react';
import {
  Radio,
  Activity,
  Flame,
  Zap,
  Gauge,
  Cpu,
  BrainCircuit,
  Database,
  ShieldCheck,
  ArrowRight,
  Menu,
  X,
  CheckCircle2,
  Layers,
  Terminal,
  Server,
  FileText,
  Mail,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface HomePageProps {
  onNavigate: (route: 'signin' | 'signup' | 'dashboard') => void;
  isAuthenticated?: boolean;
  userName?: string;
}

export const HomePage: React.FC<HomePageProps> = ({
  onNavigate,
  isAuthenticated = false,
  userName = 'Operator',
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const scrollToSection = (id: string) => {
    setIsMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const implementedFeatures = [
    {
      id: 'realtime-stream',
      title: 'Real-Time Sensor Monitoring',
      sensorTag: 'Telemetry Stream',
      icon: Activity,
      accentColor: 'cyan',
      badge: 'Live Ingest',
      description:
        'Continuous high-frequency multi-channel telemetry streaming directly from ESP32 industrial nodes to the FastAPI backend and PostgreSQL database.',
      highlights: [
        'Sub-second time-series ingest',
        'Multi-node fleet concurrency',
        'Lossless database serialization',
      ],
    },
    {
      id: 'temperature-ds18b20',
      title: 'Temperature Monitoring',
      sensorTag: 'DS18B20 Digital Sensor',
      icon: Flame,
      accentColor: 'amber',
      badge: 'Thermal Bounds',
      description:
        'Precision thermal tracking using 1-Wire digital DS18B20 sensors to detect abnormal thermal drift, bearing friction, and stator overheating.',
      highlights: [
        'Operating range: -55°C to +125°C',
        '±0.5°C industrial accuracy',
        'Configurable warning & critical limits',
      ],
    },
    {
      id: 'vibration-mpu6050',
      title: 'Vibration Monitoring',
      sensorTag: 'MPU6050 3-Axis MEMS',
      icon: Activity,
      accentColor: 'rose',
      badge: 'ISO 10816 Standard',
      description:
        '3-axis accelerometry measuring vibration velocity (RMS mm/s) to identify mechanical unbalance, misalignment, looseness, and rolling element bearing defects.',
      highlights: [
        'Tri-axial acceleration & gyro',
        'RMS velocity boundary checking',
        'Mechanical shock detection',
      ],
    },
    {
      id: 'current-acs712',
      title: 'Current Monitoring',
      sensorTag: 'ACS712 Hall-Effect Sensor',
      icon: Zap,
      accentColor: 'blue',
      badge: 'Electrical Load',
      description:
        'Hall-effect current sensing measuring motor stator amperes to detect over-current surges, phase unbalance, rotor bar faults, and abnormal mechanical load.',
      highlights: [
        'Galvanic isolation rating',
        'Instantaneous load spike capture',
        'Rated current threshold checks',
      ],
    },
    {
      id: 'rpm-hall',
      title: 'RPM & Speed Monitoring',
      sensorTag: 'Hall-Effect Speed Sensor',
      icon: Gauge,
      accentColor: 'purple',
      badge: 'Kinematics',
      description:
        'Digital pulse-counting Hall-effect speed sensing measuring rotational velocity (RPM) to detect slip, stall, belt slippage, and speed deviations.',
      highlights: [
        'High-speed pulse capture',
        'Rated RPM comparison',
        'Speed fluctuation analysis',
      ],
    },
    {
      id: 'predictive-analytics',
      title: 'Predictive Maintenance Analytics',
      sensorTag: 'Physics & ML Engine',
      icon: BrainCircuit,
      accentColor: 'emerald',
      badge: 'Diagnostic AI',
      description:
        'Deterministic physics-based boundary rules combined with machine learning pipelines to compute failure probabilities, identify root causes, and provide actionable recommendations.',
      highlights: [
        'Physics-rule prototype engine',
        'SHAP/Attribution factor breakdown',
        'Component-level failure prediction',
      ],
    },
    {
      id: 'telemetry-history',
      title: 'Machine Status & Telemetry History',
      sensorTag: 'PostgreSQL Time-Series',
      icon: Database,
      accentColor: 'cyan',
      badge: 'Asset Directory',
      description:
        'Comprehensive asset health registry with timestamped historical telemetry, maintenance logs, ground-truth feedback, and anomaly alert logs.',
      highlights: [
        'Historical sensor trend graphs',
        'Incident audit log & acknowledgement',
        'Ground-truth technician verification',
      ],
    },
  ];

  return (
    <div id="home-page" className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* ========================================================================= */}
      {/* 1. PUBLIC HEADER & NAVIGATION                                             */}
      {/* ========================================================================= */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => scrollToSection('hero')}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
              <Radio className="h-5 w-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-black tracking-wider text-white">PREDICT</span>
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-bold text-cyan-400 border border-cyan-500/30">
                  IQ
                </span>
              </div>
              <p className="text-[10px] font-mono tracking-tight text-slate-400">
                Industrial IoT Predictive Platform
              </p>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <button
              onClick={() => scrollToSection('hero')}
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              Home
            </button>
            <button
              onClick={() => scrollToSection('features')}
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection('architecture')}
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              Architecture
            </button>
            <button
              onClick={() => scrollToSection('about')}
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              About
            </button>
            <button
              onClick={() => scrollToSection('contact')}
              className="hover:text-cyan-400 transition-colors cursor-pointer"
            >
              Contact
            </button>
          </nav>

          {/* Action CTAs */}
          <div className="hidden md:flex items-center gap-3">
            {isAuthenticated ? (
              <button
                onClick={() => onNavigate('dashboard')}
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
              >
                <span>Dashboard ({userName})</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                <button
                  id="btn-nav-signin"
                  onClick={() => onNavigate('signin')}
                  className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-800 transition-all"
                >
                  Sign In
                </button>
                <button
                  id="btn-nav-getstarted"
                  onClick={() => onNavigate('signup')}
                  className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
                >
                  <span>Get Started</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:text-white"
              aria-label="Toggle Menu"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {isMobileMenuOpen && (
          <div className="border-b border-slate-800 bg-slate-950/95 px-4 py-4 md:hidden">
            <div className="flex flex-col space-y-3 text-sm font-medium text-slate-300">
              <button
                onClick={() => scrollToSection('hero')}
                className="text-left py-1 hover:text-cyan-400"
              >
                Home
              </button>
              <button
                onClick={() => scrollToSection('features')}
                className="text-left py-1 hover:text-cyan-400"
              >
                Features
              </button>
              <button
                onClick={() => scrollToSection('architecture')}
                className="text-left py-1 hover:text-cyan-400"
              >
                Architecture
              </button>
              <button
                onClick={() => scrollToSection('about')}
                className="text-left py-1 hover:text-cyan-400"
              >
                About
              </button>
              <button
                onClick={() => scrollToSection('contact')}
                className="text-left py-1 hover:text-cyan-400"
              >
                Contact
              </button>

              <div className="border-t border-slate-800 pt-3 flex flex-col gap-2">
                {isAuthenticated ? (
                  <button
                    onClick={() => onNavigate('dashboard')}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-xs font-bold text-slate-950"
                  >
                    <span>Go to Dashboard</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => onNavigate('signin')}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-xs font-semibold text-slate-200"
                    >
                      Sign In
                    </button>
                    <button
                      onClick={() => onNavigate('signup')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-xs font-bold text-slate-950"
                    >
                      <span>Get Started</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ========================================================================= */}
      {/* 2. HERO SECTION                                                           */}
      {/* ========================================================================= */}
      <section id="hero" className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-28">
        {/* Background glow effects */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-blue-600/10 to-purple-600/10 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 -right-40 h-80 w-80 rounded-full bg-cyan-500/5 blur-3xl" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300 backdrop-blur-md mb-6">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              <span>IoT-Driven Condition Monitoring & Predictive AI</span>
            </div>

            {/* Main Headline */}
            <h1 className="max-w-4xl text-3xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Predict Equipment Failures{' '}
              <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-blue-500 bg-clip-text text-transparent">
                Before They Happen.
              </span>
            </h1>

            {/* Description */}
            <p className="mt-6 max-w-2xl text-sm sm:text-base md:text-lg text-slate-300 leading-relaxed">
              Predict IQ connects directly with edge IoT microcontrollers to continuously stream real sensor telemetry,
              evaluate equipment health thresholds, and deliver physics-backed predictive maintenance diagnostics.
            </p>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <button
                id="btn-hero-getstarted"
                onClick={() => onNavigate('signup')}
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 shadow-lg shadow-cyan-500/25 hover:scale-[1.02]"
              >
                <span>Get Started</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                id="btn-hero-explore"
                onClick={() => scrollToSection('features')}
                className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-6 py-3 text-sm font-semibold text-slate-200 transition-all hover:border-cyan-500/40 hover:bg-slate-800"
              >
                <span>Explore Features</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {/* Trust / Technology Tags */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Physical ESP32 + Wokwi Integration
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> 4-Sensor Multi-Channel Bus
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Zero Synthetic Fabricated Data
              </span>
            </div>

            {/* ========================================================================= */}
            {/* Dashboard Preview / Industrial Telemetry Showcase                        */}
            {/* ========================================================================= */}
            <div className="mt-14 w-full max-w-5xl">
              <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-4 sm:p-6 shadow-2xl backdrop-blur-xl">
                {/* Mock Window Top Bar */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                    <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                    <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 font-mono text-xs text-slate-400 hidden sm:inline">
                      predict-iq-telemetry-workbench // esp32-node-01
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      SYSTEM ONLINE
                    </span>
                  </div>
                </div>

                {/* 4 Multi-Channel Sensor Readout Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 text-left">
                  {/* Temp Card */}
                  <div className="rounded-xl border border-amber-500/20 bg-slate-950/80 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-slate-400">Temperature</span>
                      <Flame className="h-4 w-4 text-amber-400" />
                    </div>
                    <div className="mt-2 font-mono text-lg sm:text-xl font-bold text-amber-400">
                      DS18B20
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      1-Wire Digital Thermal Bus
                    </div>
                  </div>

                  {/* Vibration Card */}
                  <div className="rounded-xl border border-rose-500/20 bg-slate-950/80 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-slate-400">Vibration</span>
                      <Activity className="h-4 w-4 text-rose-400" />
                    </div>
                    <div className="mt-2 font-mono text-lg sm:text-xl font-bold text-rose-400">
                      MPU6050
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Tri-Axial Accelerometer (RMS)
                    </div>
                  </div>

                  {/* Current Card */}
                  <div className="rounded-xl border border-blue-500/20 bg-slate-950/80 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-slate-400">Current</span>
                      <Zap className="h-4 w-4 text-cyan-400" />
                    </div>
                    <div className="mt-2 font-mono text-lg sm:text-xl font-bold text-cyan-400">
                      ACS712
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Hall-Effect Motor Amperage
                    </div>
                  </div>

                  {/* RPM Card */}
                  <div className="rounded-xl border border-purple-500/20 bg-slate-950/80 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-slate-400">Rotational Speed</span>
                      <Gauge className="h-4 w-4 text-purple-400" />
                    </div>
                    <div className="mt-2 font-mono text-lg sm:text-xl font-bold text-purple-400">
                      Hall Speed
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      Digital Pulse Tachometer
                    </div>
                  </div>
                </div>

                {/* Workflow / Architecture Pipeline Bar */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 text-left">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 font-mono font-bold">
                        AI
                      </div>
                      <div>
                        <div className="font-bold text-slate-200">Continuous Fleet Telemetry Pipeline</div>
                        <div className="text-slate-400 text-[11px]">
                          Edge Microcontroller → FastAPI Ingest Gateway → PostgreSQL → Condition Engine
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onNavigate('signin')}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-cyan-400 hover:bg-slate-700 transition-colors"
                    >
                      Launch Live Fleet &rarr;
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. FEATURES SECTION                                                       */}
      {/* ========================================================================= */}
      <section id="features" className="border-t border-slate-850 bg-slate-950 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Complete Feature Architecture
            </h2>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-4xl">
              Engineered for Industrial Reliability & Accuracy
            </h3>
            <p className="mt-4 text-sm sm:text-base text-slate-400">
              Only features built and supported by the Predict IQ telemetry stack are represented.
              Zero synthetic mock statistics or fabricated metrics.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {implementedFeatures.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.id}
                  className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition-all duration-300 hover:border-cyan-500/40 hover:bg-slate-900/90 shadow-lg hover:shadow-cyan-500/5"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-105 transition-transform">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300 border border-slate-700">
                        {feat.badge}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-cyan-400 font-semibold mb-1">
                      {feat.sensorTag}
                    </div>
                    <h4 className="text-lg font-bold text-white mb-2">{feat.title}</h4>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                      {feat.description}
                    </p>
                  </div>

                  <div className="mt-6 border-t border-slate-800/80 pt-4">
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {feat.highlights.map((h, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. ARCHITECTURE SECTION                                                   */}
      {/* ========================================================================= */}
      <section id="architecture" className="border-t border-slate-800 bg-slate-900/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              System Architecture
            </h2>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-4xl">
              From Edge Microcontroller to Cloud Diagnostic AI
            </h3>
            <p className="mt-4 text-sm sm:text-base text-slate-400">
              End-to-end industrial data architecture designed for low latency, zero data fabrication, and deterministic physics rule verification.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Step 1 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 font-mono font-bold mb-4">
                01
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Edge Sensor Bus</h4>
              <p className="text-xs text-slate-400">
                Physical ESP32 & Wokwi simulated firmware sampling DS18B20, MPU6050, ACS712, and Hall-effect sensors.
              </p>
            </div>

            {/* Step 2 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 font-mono font-bold mb-4">
                02
              </div>
              <h4 className="text-sm font-bold text-white mb-1">FastAPI REST Gateway</h4>
              <p className="text-xs text-slate-400">
                High-performance Python gateway enforcing write-gate API key validation and operator session security.
              </p>
            </div>

            {/* Step 3 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 font-mono font-bold mb-4">
                03
              </div>
              <h4 className="text-sm font-bold text-white mb-1">PostgreSQL Time-Series</h4>
              <p className="text-xs text-slate-400">
                Relational persistence storing historical telemetry frames, machine asset registries, alerts, and technician ground-truth.
              </p>
            </div>

            {/* Step 4 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-mono font-bold mb-4">
                04
              </div>
              <h4 className="text-sm font-bold text-white mb-1">Physics & ML Engine</h4>
              <p className="text-xs text-slate-400">
                Multi-parameter anomaly detection, ISO vibration evaluation, thermal gradient checks, and XAI feature attribution.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. ABOUT SECTION                                                          */}
      {/* ========================================================================= */}
      <section id="about" className="border-t border-slate-800 bg-slate-950 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
                About Predict IQ
              </h2>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Industrial Intelligence Driven by Physics & Real Hardware
              </h3>
              <p className="mt-4 text-sm text-slate-300 leading-relaxed">
                Predict IQ is built to eliminate unplanned industrial machinery downtime through real-time multi-sensor telemetry and transparent condition classification.
              </p>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                Unlike systems that fabricate synthetic demo readings, Predict IQ is anchored in strict data integrity: every metric displayed traces directly to an authenticated ESP32 hardware node or verified operator input stored in PostgreSQL.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                  <div className="font-mono text-sm font-bold text-cyan-400">100% Real Data</div>
                  <div className="text-[11px] text-slate-400">Zero synthetic fake metrics</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                  <div className="font-mono text-sm font-bold text-emerald-400">ESP32 & Wokwi</div>
                  <div className="text-[11px] text-slate-400">Hardware & simulation modes</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                  <div className="font-mono text-sm font-bold text-purple-400">Explainable AI</div>
                  <div className="text-[11px] text-slate-400">Transparent attribution</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-cyan-400" />
                <span>Supported Industrial Assets</span>
              </h4>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-cyan-400" />
                    <span className="font-semibold text-slate-200">Centrifugal Pumps</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">Cavitation & Bearing Wear</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-amber-400" />
                    <span className="font-semibold text-slate-200">Three-Phase Induction Motors</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">Stator Overheat & Unbalance</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-rose-400" />
                    <span className="font-semibold text-slate-200">CNC High-Speed Spindles</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">Vibration & RPM Drift</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-purple-400" />
                    <span className="font-semibold text-slate-200">Rotary Screw Compressors</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">Thermal & Load Surges</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. CONTACT & FOOTER SECTION                                               */}
      {/* ========================================================================= */}
      <footer id="contact" className="border-t border-slate-800 bg-slate-950 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            {/* Branding */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/20">
                  <Radio className="h-4 w-4 text-slate-950" />
                </div>
                <span className="text-base font-black tracking-wider text-white">PREDICT<span className="text-cyan-400">IQ</span></span>
              </div>
              <p className="mt-3 text-xs text-slate-400 max-w-sm leading-relaxed">
                IoT predictive maintenance platform providing real-time telemetry streaming, condition analytics, and physics-rule diagnostics.
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Navigation</h5>
              <ul className="space-y-2 text-xs text-slate-400">
                <li><button onClick={() => scrollToSection('hero')} className="hover:text-cyan-400">Home</button></li>
                <li><button onClick={() => scrollToSection('features')} className="hover:text-cyan-400">Features</button></li>
                <li><button onClick={() => scrollToSection('architecture')} className="hover:text-cyan-400">Architecture</button></li>
                <li><button onClick={() => scrollToSection('about')} className="hover:text-cyan-400">About Platform</button></li>
              </ul>
            </div>

            {/* Access */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Operator Access</h5>
              <div className="space-y-2 text-xs">
                <button
                  onClick={() => onNavigate('signin')}
                  className="block text-cyan-400 hover:text-cyan-300 font-semibold"
                >
                  Sign In to Dashboard &rarr;
                </button>
                <button
                  onClick={() => onNavigate('signup')}
                  className="block text-slate-400 hover:text-white"
                >
                  Create Operator Account
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800/80 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500 font-mono">
            <span>&copy; {new Date().getFullYear()} Predict IQ &middot; Industrial IoT Predictive Maintenance</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Real Telemetry System
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
export default HomePage;
