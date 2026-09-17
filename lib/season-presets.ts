export type SeasonPreset = {
  id: string;
  name: string;
  description: string;
  theme: string;
  particle: string;
  intensity: number;
  decorations?: Record<string, boolean>;
};

export const SEASON_PRESETS: SeasonPreset[] = [
  {id:"winter",name:"Winter (Зима)",description:"Плотный мягкий снег, морозный фон и снежные края окон",theme:"WINTER",particle:"winter",intensity:92,decorations:{snowman:true}},
  {id:"spring",name:"Spring (Весна)",description:"Свежий весенний фон, лепестки и цветочный декор",theme:"SPRING",particle:"spring",intensity:58,decorations:{flowers:true}},
  {id:"summer",name:"Summer (Лето)",description:"Солнечный фон, тёплые частицы и лёгкое свечение",theme:"SUMMER",particle:"summer",intensity:48,decorations:{sun:true}},
  {id:"autumn",name:"Autumn (Осень)",description:"Осенний фон, золотые листья и тёплое свечение",theme:"AUTUMN",particle:"autumn",intensity:68,decorations:{leaf:true}},
  {id:"new-year",name:"New Year (Новый год)",description:"Зима, плотный снег, ёлка, огни, подарки и салют",theme:"WINTER",particle:"newyear",intensity:98,decorations:{snowman:true,tree:true,gift:true,fireworks:true}},
  {id:"christmas",name:"Christmas (Рождество)",description:"Рождественская зима, снег, ёлка, подарки и морозный декор",theme:"WINTER",particle:"christmas",intensity:92,decorations:{snowman:true,tree:true,gift:true}},
  {id:"halloween",name:"Halloween (Хэллоуин)",description:"Тёмный хэллоуинский фон, тыквы, призраки и оранжевые частицы",theme:"HALLOWEEN",particle:"halloween",intensity:58,decorations:{pumpkin:true,ghost:true}},
  {id:"easter",name:"Easter (Пасха)",description:"Весенний фон, цветы, яйца и мягкие праздничные частицы",theme:"SPRING",particle:"easter",intensity:52,decorations:{flowers:true,eggs:true}},
  {id:"valentines",name:"Valentine's Day (14 февраля)",description:"Розовый праздничный фон, сердечки и мягкое свечение",theme:"VALENTINE",particle:"hearts",intensity:52,decorations:{hearts:true}},
  {id:"st-patricks",name:"St. Patrick's Day",description:"Зелёная праздничная атмосфера, клевер и световые частицы",theme:"SPRING",particle:"stpatricks",intensity:46,decorations:{flowers:true,clover:true}},
  {id:"april-fools",name:"April Fools (1 апреля)",description:"Яркий игровой фон, конфетти и праздничная анимация",theme:"SPRING",particle:"confetti",intensity:54,decorations:{confetti:true}},
  {id:"lunar-new-year",name:"Lunar New Year (Лунный Новый год)",description:"Красные фонари, золотые частицы и праздничное свечение",theme:"CRIMSON",particle:"lunarnewyear",intensity:64,decorations:{lanterns:true,fireworks:true}},
  {id:"thanksgiving",name:"Thanksgiving (День благодарения)",description:"Тёплый осенний фон, золотые листья и праздничный декор",theme:"AUTUMN",particle:"autumn",intensity:56,decorations:{leaf:true,turkey:true}},
  {id:"esports",name:"Esports (Киберспорт)",description:"Неоновая соревновательная атмосфера без сезонного декора",theme:"ESPORTS",particle:"esports",intensity:36},
  {id:"none",name:"None (Без эффектов)",description:"Полностью отключить сезонные эффекты",theme:"DEFAULT",particle:"default",intensity:0},
];
