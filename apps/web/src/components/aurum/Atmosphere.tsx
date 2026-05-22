// Atmosphere — fundo "futurista" do cockpit (piloto JurisFlow 2026-05-22).
// Glows dourado/jade/azure que driftam + grid fade + horizonte. Fixed,
// pointer-events-none, fica atras de tudo (z-0).
export function Atmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#05070d]">
      {/* Vinheta base */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-10%,#0c1322_0%,#070a12_45%,#05070d_100%)]" />
      {/* Glow aurum drifting */}
      <div className="absolute -left-[12%] -top-[18%] h-[60vh] w-[60vh] rounded-full bg-[radial-gradient(circle,rgba(230,190,106,0.16),transparent_62%)] blur-3xl animate-aurum-drift" />
      {/* Glow jade */}
      <div className="absolute -right-[10%] top-[28%] h-[55vh] w-[55vh] rounded-full bg-[radial-gradient(circle,rgba(67,224,160,0.10),transparent_60%)] blur-3xl animate-aurum-drift-slow" />
      {/* Haze azure */}
      <div className="absolute bottom-[-20%] left-[30%] h-[50vh] w-[50vh] rounded-full bg-[radial-gradient(circle,rgba(91,157,255,0.07),transparent_60%)] blur-3xl animate-aurum-drift" />
      {/* Grid fraco */}
      <div className="absolute inset-0 aurum-grid-fade [background-size:64px_64px] [mask-image:radial-gradient(120%_90%_at_50%_0%,#000_30%,transparent_75%)]" />
      {/* Linha de horizonte no topo */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-aurum/30 to-transparent" />
    </div>
  );
}
