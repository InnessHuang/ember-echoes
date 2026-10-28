export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
      <header className="border-b border-white/15 pb-10">
        <p className="text-sm tracking-widest text-orange-300">余烬回响 · 数值策划作品集</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Ember Echoes</h1>
        <p className="mt-6 max-w-2xl leading-8 text-stone-300">
          一个面向中国大陆 2027 届校招的原创回合制战斗 Demo 项目。
          通过规则设计、参数配置、策略比较和测试证据，呈现数值设计与平衡迭代的过程。
        </p>
        <p className="mt-6 text-sm text-orange-200">当前项目阶段：设计规范与工程基础</p>
      </header>
      <section aria-labelledby="mechanics" className="py-10">
        <h2 id="mechanics" className="text-xl font-semibold">核心机制 · 计划设计</h2>
        <ul className="mt-5 list-disc space-y-3 pl-5 leading-7 text-stone-300">
          <li>预判敌方行动意图，在普攻、重击、防御和蓄能之间做出选择。</li>
          <li>管理生命与能量，权衡即时输出和后续行动空间。</li>
          <li>战胜轻型敌人、重型敌人与 Boss，通过胜后升级形成成长路线。</li>
        </ul>
      </section>
      <section aria-labelledby="demo" className="rounded-xl border border-dashed border-orange-300/40 bg-orange-300/5 p-8">
        <p className="text-xs tracking-widest text-orange-300">DEMO / 待开发</p>
        <h2 id="demo" className="mt-3 text-2xl font-semibold">战斗 Demo 尚未实现</h2>
        <p className="mt-4 leading-7 text-stone-300">本页仅为项目入口与占位展示。战斗规则引擎、交互界面和模拟分析将在后续阶段逐步实现与验证。</p>
      </section>
      <footer className="mt-12 text-sm leading-7 text-stone-400">原创角色、技能、敌人、数值与关卡设计 · 用可验证的规则支持设计决策</footer>
    </main>
  );
}
