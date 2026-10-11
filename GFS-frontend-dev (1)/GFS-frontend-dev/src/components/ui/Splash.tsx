import Spinner from "@/components/ui/Spinner";

const Splash = () => (
  <div className="min-h-screen w-full flex flex-col items-center justify-center gap-8 bg-[#E9EBF2]">
    <img
      src="/gfs.png"
      alt="smartmfgAI Everywhere"
      className="w-40 select-none animate-splash drop-shadow-sm"
      draggable={false}
    />
    <Spinner size={30} />
  </div>
);

export default Splash;
