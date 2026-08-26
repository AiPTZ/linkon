const WHATSAPP_URL =
  "https://wa.me/5519990041826?text=Ol%C3%A1%2C%20preciso%20de%20suporte%20no%20Link%20ON!";

export function SupportBubble() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Falar com o suporte no WhatsApp"
      className="group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] p-3.5 text-white shadow-[0_8px_30px_rgba(37,211,102,0.35)] transition-all duration-300 hover:scale-105 hover:shadow-[0_8px_30px_rgba(37,211,102,0.55)]"
    >
      <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M16.004 0C7.168 0 0 7.168 0 16.004c0 2.828.742 5.582 2.16 8.02L0 32l8.117-2.11c2.34 1.258 4.998 1.918 7.887 1.918 8.836 0 16.004-7.168 16.004-16.004C32 7.168 24.832 0 16.004 0zm0 29.066c-2.36 0-4.677-.63-6.707-1.817l-.48-.285-4.818 1.254 1.29-4.7-.313-.495a13.08 13.08 0 0 1-2.002-6.998C3.074 8.836 8.836 3.074 16.004 3.074c3.414 0 6.623 1.332 9.033 3.75a12.72 12.72 0 0 1 3.737 9.028c0 7.167-5.832 13.214-13.77 13.214zm7.168-9.895c-.395-.2-2.336-1.148-2.699-1.28-.363-.13-.626-.196-.89.2-.263.398-1.02 1.28-1.25 1.544-.23.263-.46.296-.854.099-.395-.2-1.666-.61-3.172-1.954-1.172-1.04-1.964-2.325-2.193-2.718-.23-.393-.024-.605.174-.8.177-.177.395-.46.592-.691.198-.23.263-.395.395-.66.132-.263.066-.494-.033-.692-.099-.198-.89-2.137-1.218-2.928-.32-.77-.647-.665-.89-.677-.23-.012-.494-.014-.757-.014-.264 0-.692.099-1.054.494-.362.395-1.383 1.35-1.383 3.292s1.416 3.82 1.614 4.084c.198.264 2.788 4.273 6.756 5.99.944.41 1.68.654 2.254.836.947.3 1.809.257 2.49.156.76-.113 2.336-.953 2.666-1.874.33-.922.33-1.711.23-1.876-.099-.164-.363-.263-.757-.462z" />
      </svg>
      <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-300 group-hover:max-w-[8rem] group-hover:opacity-100">
        Suporte
      </span>
    </a>
  );
}
