import { useCallback, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Cpu,
  FlaskConical,
  Globe,
  Layers3,
  MapPinned,
  MonitorSmartphone,
  Route,
  ScanLine,
  ShieldCheck,
  TabletSmartphone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../hooks/useLanguage';

type CardDefinition = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function ProductSplitGraphic({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#101925] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#60a5fa]">{t('landing.platforms.webLabel')}</div>
            <div className="mt-2 text-2xl font-black uppercase text-white">{t('landing.platforms.webTitle')}</div>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#034f8b] text-white">
            <MonitorSmartphone className="h-7 w-7" />
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
            <Layers3 className="h-4 w-4 text-[#72b944]" />
            {t('landing.platforms.webPanelTitle')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              t('landing.platforms.webFeatureA'),
              t('landing.platforms.webFeatureB'),
              t('landing.platforms.webFeatureC'),
              t('landing.platforms.webFeatureD'),
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-white/8 bg-[#162232] px-4 py-3 text-sm font-medium text-slate-200 shadow-sm">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-[#72b944]/20 bg-gradient-to-br from-[#122015] via-[#132117] to-[#0f1921] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.38)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-[#72b944]">{t('landing.platforms.fieldLabel')}</div>
            <div className="mt-2 text-2xl font-black uppercase text-white">{t('landing.platforms.fieldTitle')}</div>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#72b944] text-white">
            <TabletSmartphone className="h-7 w-7" />
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
          <div className="relative overflow-hidden rounded-[1.4rem] bg-[#0f2235] p-5 text-white">
            <div className="absolute right-3 top-3 rounded-full bg-[#ff8200] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
              Field mode
            </div>
            <div className="grid gap-4 sm:grid-cols-[0.9fr_1.1fr] sm:items-end">
              <div className="mx-auto h-48 w-24 rounded-[1.8rem] border-4 border-white/15 bg-[#172f47] p-3 shadow-2xl">
                <div className="flex h-full flex-col rounded-[1.2rem] bg-[#eff6ff] p-3">
                  <div className="rounded-xl bg-[#034f8b] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white">GPS</div>
                  <div className="mt-3 flex-1 rounded-2xl border border-dashed border-[#72b944]/50 bg-[#dff0cf] p-2">
                    <div className="h-full rounded-xl bg-[linear-gradient(180deg,#f9fff0_0%,#d9eec5_100%)]">
                      <div className="mx-auto mt-5 h-6 w-6 rounded-full border-4 border-[#ff8200] bg-white" />
                      <div className="mx-auto mt-6 h-10 w-10 rounded-full border border-[#034f8b]/20 bg-[#034f8b]/10" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { icon: Barcode, label: t('landing.platforms.fieldFeatureA') },
                  { icon: ScanLine, label: t('landing.platforms.fieldFeatureB') },
                  { icon: Cpu, label: t('landing.platforms.fieldFeatureC') },
                  { icon: Route, label: t('landing.platforms.fieldFeatureD') },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white backdrop-blur-sm">
                    <item.icon className="h-5 w-5 text-[#ff8200]" />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroGraphic({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <div className="relative mx-auto w-full max-w-[38rem]">
      <div className="absolute -left-8 top-8 h-44 w-44 rounded-full bg-[#72b944]/18 blur-3xl" />
      <div className="absolute -right-12 top-6 h-44 w-44 rounded-full bg-[#ff8200]/15 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-[#034f8b]/12 blur-3xl" />

      <div className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#101925] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.4)]">
        <div className="rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,#0f1724_0%,#122032_100%)] p-4">
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-300">
            <span>{t('landing.graphic.panelLabel')}</span>
            <span className="rounded-full bg-[#034f8b] px-3 py-1 text-[10px] font-semibold text-white">GPS</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
            <div className="relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#152435] p-4">
              <div
                className="absolute inset-0 opacity-70"
                style={{
                  backgroundImage: 'linear-gradient(rgba(3, 79, 139, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(3, 79, 139, 0.08) 1px, transparent 1px), radial-gradient(circle at 12% 12%, rgba(114, 185, 68, 0.18), transparent 30%), radial-gradient(circle at 84% 22%, rgba(255, 130, 0, 0.14), transparent 28%)',
                  backgroundSize: '44px 44px, 44px 44px, auto, auto',
                }}
              />

              <div className="relative flex items-center justify-between text-sm text-slate-200">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{t('landing.graphic.mapLabel')}</div>
                  <div className="mt-1 font-semibold text-white">{t('landing.graphic.mapValue')}</div>
                </div>
                <MapPinned className="h-5 w-5 text-[#034f8b]" />
              </div>

              <svg viewBox="0 0 460 300" className="relative mt-6 h-64 w-full">
                <path d="M30 230 L110 55 L255 35 L415 115 L370 250 L225 275 Z" fill="rgba(114, 185, 68, 0.10)" stroke="rgba(114, 185, 68, 0.55)" strokeWidth="3" />
                <path d="M135 74 L205 252" stroke="rgba(255, 130, 0, 0.42)" strokeWidth="2.5" strokeDasharray="10 10" />
                <path d="M255 35 L285 268" stroke="rgba(255, 130, 0, 0.42)" strokeWidth="2.5" strokeDasharray="10 10" />
                <path d="M82 145 L385 185" stroke="rgba(255, 130, 0, 0.35)" strokeWidth="2.5" strokeDasharray="12 8" />
                <path d="M58 202 C132 152 208 110 324 120 C346 122 370 130 393 144" fill="none" stroke="rgba(3, 79, 139, 0.85)" strokeWidth="4" strokeLinecap="round" />
                {[{ x: 112, y: 175 }, { x: 166, y: 128 }, { x: 237, y: 152 }, { x: 295, y: 115 }, { x: 340, y: 152 }].map((point, index) => (
                  <g key={index}>
                    <circle cx={point.x} cy={point.y} r="18" fill="rgba(255,255,255,0.92)" stroke="rgba(255, 130, 0, 0.85)" strokeWidth="2.5" />
                    <circle cx={point.x} cy={point.y} r="6.5" fill="rgba(255, 130, 0, 1)" />
                  </g>
                ))}
              </svg>
            </div>

            <div className="flex flex-col gap-3">
              {[
                { label: t('landing.graphic.contractLabel'), value: t('landing.graphic.contractValue'), accent: 'from-[#ff8200]/18 to-[#ff8200]/5' },
                { label: t('landing.graphic.gpsLabel'), value: t('landing.graphic.gpsValue'), accent: 'from-[#034f8b]/15 to-[#034f8b]/5' },
                { label: t('landing.graphic.exportLabel'), value: t('landing.graphic.exportValue'), accent: 'from-[#72b944]/18 to-[#72b944]/5' },
              ].map((item) => (
                <div key={item.label} className={`rounded-[1.35rem] border border-white/10 bg-gradient-to-br ${item.accent} p-4`}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                  <div className="mt-2 text-base font-bold uppercase leading-snug text-white">{item.value}</div>
                </div>
              ))}
              <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-slate-100">
                  <CheckCircle2 className="h-4 w-4 text-[#72b944]" />
                  <span>AGROLAB</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1">LUFA-NRW</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1">PBS</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1">CSV / XML / XLSX</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, body }: CardDefinition) {
  return (
    <div className="rounded-[1.8rem] border border-white/10 bg-[#101925] p-6 shadow-[0_18px_45px_rgba(0,0,0,0.28)] transition-transform duration-300 hover:-translate-y-1 hover:border-[#72b944]/30 hover:shadow-[0_24px_55px_rgba(0,0,0,0.35)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#034f8b] text-white">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-xl font-black uppercase text-white">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-slate-300">{body}</p>
    </div>
  );
}

export default function LandingPage() {
  const { t, language, changeLanguage } = useLanguage();
  const { isAuthenticated } = useAuth();
  const activeLanguage = language.toLowerCase().startsWith('de') ? 'de' : 'en';
  const primaryPath = isAuthenticated ? '/app' : '/login';
  const primaryLabel = isAuthenticated ? t('landing.hero.primaryLoggedIn') : t('landing.hero.primary');
  const finalPrimaryLabel = isAuthenticated ? t('landing.finalCta.primaryLoggedIn') : t('landing.finalCta.primary');

  const scrollToSection = useCallback((id: string) => {
    const section = document.getElementById(id);
    if (!section) return;

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = root?.style.overflow ?? '';
    const previousHtmlOverflowY = document.documentElement.style.overflowY;
    const previousBodyOverflowY = document.body.style.overflowY;
    const previousRootOverflowY = root?.style.overflowY ?? '';

    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.overflowY = 'auto';
    if (root) {
      root.style.overflow = 'visible';
      root.style.overflowY = 'visible';
    }

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overflowY = previousBodyOverflowY;
      if (root) {
        root.style.overflow = previousRootOverflow;
        root.style.overflowY = previousRootOverflowY;
      }
    };
  }, []);

  const featureCards: CardDefinition[] = [
    {
      icon: MapPinned,
      title: t('landing.features.mappingTitle'),
      body: t('landing.features.mappingBody'),
    },
    {
      icon: ClipboardList,
      title: t('landing.features.contractsTitle'),
      body: t('landing.features.contractsBody'),
    },
    {
      icon: Route,
      title: t('landing.features.gpsTitle'),
      body: t('landing.features.gpsBody'),
    },
    {
      icon: FlaskConical,
      title: t('landing.features.exportsTitle'),
      body: t('landing.features.exportsBody'),
    },
  ];

  const workflowSteps: CardDefinition[] = [
    {
      icon: ClipboardList,
      title: t('landing.workflow.step1Title'),
      body: t('landing.workflow.step1Body'),
    },
    {
      icon: Layers3,
      title: t('landing.workflow.step2Title'),
      body: t('landing.workflow.step2Body'),
    },
    {
      icon: TabletSmartphone,
      title: t('landing.workflow.step3Title'),
      body: t('landing.workflow.step3Body'),
    },
    {
      icon: ShieldCheck,
      title: t('landing.workflow.step4Title'),
      body: t('landing.workflow.step4Body'),
    },
  ];

  const audienceCards: CardDefinition[] = [
    {
      icon: CheckCircle2,
      title: t('landing.audiences.consultantsTitle'),
      body: t('landing.audiences.consultantsBody'),
    },
    {
      icon: TabletSmartphone,
      title: t('landing.audiences.samplingTitle'),
      body: t('landing.audiences.samplingBody'),
    },
    {
      icon: FlaskConical,
      title: t('landing.audiences.serviceTitle'),
      body: t('landing.audiences.serviceBody'),
    },
  ];

  return (
    <div
      className="landing-brand-font relative isolate h-[100dvh] overflow-x-hidden overflow-y-auto bg-[#081018] text-slate-100"
      style={{
        backgroundImage: 'radial-gradient(circle at top left, rgba(114, 185, 68, 0.14), transparent 28%), radial-gradient(circle at 82% 12%, rgba(255, 130, 0, 0.14), transparent 22%), linear-gradient(180deg, #081018 0%, #0d1622 42%, #101925 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />

      <header className="relative z-10 border-b border-white/10 bg-[#081018]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <div>
            <img
              src="/app-logo.png"
              alt={t('app.name')}
              className="h-16 w-16 object-contain"
            />
          </div>

          <div className="hidden items-center gap-6 text-sm font-bold uppercase tracking-[0.12em] text-slate-300 lg:flex">
            <button type="button" onClick={() => scrollToSection('features')} className="transition-colors hover:text-[#034f8b]">{t('landing.nav.features')}</button>
            <button type="button" onClick={() => scrollToSection('workflow')} className="transition-colors hover:text-[#034f8b]">{t('landing.nav.workflow')}</button>
            <button type="button" onClick={() => scrollToSection('platforms')} className="transition-colors hover:text-[#034f8b]">{t('landing.nav.platforms')}</button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[#22384f] bg-[#0b1624] p-1">
              <Globe className="h-4 w-4 text-slate-400 ml-2" />
              <button
                type="button"
                onClick={() => changeLanguage('de')}
                aria-pressed={activeLanguage === 'de'}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${activeLanguage === 'de'
                  ? 'bg-[#034f8b] text-white'
                  : 'text-slate-300 hover:text-white'
                }`}
              >
                Deutsch
              </button>
              <button
                type="button"
                onClick={() => changeLanguage('en')}
                aria-pressed={activeLanguage === 'en'}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${activeLanguage === 'en'
                  ? 'bg-[#034f8b] text-white'
                  : 'text-slate-300 hover:text-white'
                }`}
              >
                English
              </button>
            </div>

            <Link
              to={primaryPath}
              className="inline-flex items-center gap-2 rounded-full bg-[#72b944] px-4 py-2 text-sm font-bold uppercase tracking-[0.12em] text-white transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[#5e9f35]"
            >
              {t('landing.nav.openApp')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-7xl px-6 pb-20 pt-14 lg:px-10 lg:pb-28 lg:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#60a5fa] shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#72b944]" />
                {t('landing.hero.eyebrow')}
              </div>
              <h1 className="mt-7 max-w-3xl text-5xl font-black uppercase leading-[0.96] tracking-tight text-white sm:text-6xl">
                {t('landing.hero.title')}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                {t('landing.hero.subtitle')}
              </p>

              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <Link
                  to={primaryPath}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#72b944] px-6 py-3.5 text-base font-bold uppercase tracking-[0.12em] text-white transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[#5e9f35]"
                >
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => scrollToSection('workflow')}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-6 py-3.5 text-base font-bold uppercase tracking-[0.12em] text-slate-100 transition-colors hover:border-[#034f8b]/40 hover:bg-[#034f8b]/10"
                >
                  {t('landing.hero.secondary')}
                </button>
              </div>

              <div className="mt-10 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
                {[t('landing.hero.proofA'), t('landing.hero.proofB'), t('landing.hero.proofC')].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#72b944]" />
                      <span>{item}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <HeroGraphic t={t} />
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              { value: t('landing.metrics.contractsValue'), label: t('landing.metrics.contractsLabel') },
              { value: t('landing.metrics.fieldOpsValue'), label: t('landing.metrics.fieldOpsLabel') },
              { value: t('landing.metrics.exportsValue'), label: t('landing.metrics.exportsLabel') },
            ].map((item) => (
              <div key={item.value} className="rounded-[1.6rem] border border-white/10 bg-[#101925] px-6 py-6 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
                <div className="text-3xl font-black uppercase text-[#034f8b]">{item.value}</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20 lg:px-10">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#034f8b]">{t('landing.features.eyebrow')}</div>
            <h2 className="mt-4 text-4xl font-black uppercase text-white sm:text-5xl">
              {t('landing.features.title')}
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">{t('landing.features.subtitle')}</p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {featureCards.map((card) => (
              <SectionCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
            <div>
              <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#ff8200]">{t('landing.workflow.eyebrow')}</div>
              <h2 className="mt-4 text-4xl font-black uppercase text-white sm:text-5xl">
                {t('landing.workflow.title')}
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-300">{t('landing.workflow.subtitle')}</p>
            </div>

            <div className="space-y-4">
              {workflowSteps.map((step, index) => (
                <div key={step.title} className="flex gap-4 rounded-[1.6rem] border border-white/10 bg-[#101925] p-5 shadow-[0_14px_36px_rgba(0,0,0,0.26)]">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ff8200] text-white">
                    <step.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff8200]">0{index + 1}</div>
                    <h3 className="mt-2 text-xl font-black uppercase text-white">{step.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platforms" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20 lg:px-10">
          <div className="max-w-4xl">
            <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#72b944]">{t('landing.platforms.eyebrow')}</div>
            <h2 className="mt-4 text-4xl font-black uppercase text-white sm:text-5xl">
              {t('landing.platforms.title')}
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">{t('landing.platforms.subtitle')}</p>
          </div>

          <div className="mt-12">
            <ProductSplitGraphic t={t} />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="rounded-[2rem] border border-white/10 bg-[#101925] p-8 shadow-[0_18px_50px_rgba(0,0,0,0.28)] lg:p-10">
            <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#034f8b]">{t('landing.compatibility.eyebrow')}</div>
            <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
              <div>
                <h2 className="text-4xl font-black uppercase text-white sm:text-5xl">
                  {t('landing.compatibility.title')}
                </h2>
                <p className="mt-5 text-lg leading-8 text-slate-300">{t('landing.compatibility.subtitle')}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {['AGROLAB', 'LUFA-NRW', 'PBS'].map((provider) => (
                  <div key={provider} className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] px-5 py-6 text-center">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Provider</div>
                    <div className="mt-3 text-2xl font-black uppercase text-white">{provider}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="audiences" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20 lg:px-10">
          <div className="max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.24em] text-[#034f8b]">{t('landing.audiences.eyebrow')}</div>
            <h2 className="mt-4 text-4xl font-black uppercase text-white sm:text-5xl">
              {t('landing.audiences.title')}
            </h2>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {audienceCards.map((card) => (
              <SectionCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-24 pt-6 lg:px-10 lg:pb-28">
          <div className="overflow-hidden rounded-[2.2rem] border border-white/10 bg-gradient-to-br from-[#101925] via-[#132234] to-[#162318] p-8 shadow-[0_25px_70px_rgba(0,0,0,0.34)] lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <h2 className="text-4xl font-black uppercase text-white sm:text-5xl">
                  {t('landing.finalCta.title')}
                </h2>
                <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">{t('landing.finalCta.subtitle')}</p>
              </div>

              <div className="flex flex-col gap-3">
                <Link
                  to={primaryPath}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#72b944] px-6 py-3.5 text-base font-bold uppercase tracking-[0.12em] text-white transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[#5e9f35]"
                >
                  {finalPrimaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}