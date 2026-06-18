import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type OrderLegalDocumentKey = 'privacy' | 'processing' | 'digital' | 'terms';

type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalDocument = {
  eyebrow: string;
  title: string;
  subtitle: string;
  sections: LegalSection[];
  footer?: string;
};

type OrderLegalModalProps = {
  documentKey: OrderLegalDocumentKey;
  onClose: () => void;
};

const OrderLegalModal = ({ documentKey, onClose }: OrderLegalModalProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const document = t(`orders.wizard.legalDocuments.${documentKey}`, {
    returnObjects: true,
  }) as LegalDocument;

  return (
    <div className="fixed inset-0 z-[6000] overflow-y-auto bg-black/35 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex min-h-full items-start justify-center py-4 sm:items-center sm:py-8">
        <div
          className="w-full max-w-3xl my-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="max-h-[85vh] flex flex-col overflow-hidden rounded-xl shadow-2xl bg-white/95 dark:bg-gray-900/95 border border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {document.eyebrow}
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {document.title}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {document.subtitle}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100/70 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800/60 transition-colors"
                aria-label={t('common.close')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-5 text-sm text-gray-700 dark:text-gray-200 scrollbar-modern"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {document.sections.map((section, index) => (
                <section key={`${documentKey}-${index}`} className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{section.heading}</h3>
                  {section.paragraphs?.map((paragraph, paragraphIndex) => (
                    <p key={`${documentKey}-${index}-p-${paragraphIndex}`} className="leading-6">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets?.length ? (
                    <ul className="list-disc pl-5 space-y-1.5 leading-6">
                      {section.bullets.map((bullet, bulletIndex) => (
                        <li key={`${documentKey}-${index}-b-${bulletIndex}`}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}

              {document.footer ? (
                <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 dark:border-amber-800/50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 leading-5">
                  {document.footer}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderLegalModal;