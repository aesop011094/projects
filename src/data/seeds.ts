import type { AppData, Category, Ingredient, Recipe } from '../types';

export const defaultCategories: Category[] = [
  { id: 'category-hong-kong', name: '港式料理', emoji: '🥢' },
  { id: 'category-chinese', name: '中式料理', emoji: '🥟' },
  { id: 'category-japanese', name: '日式料理', emoji: '🍱' },
  { id: 'category-korean', name: '韓式料理', emoji: '🍲' },
  { id: 'category-western', name: '西式料理', emoji: '🍝' },
  { id: 'category-air-fryer', name: '氣炸鍋料理', emoji: '🍗' },
  { id: 'category-microwave', name: '微波爐料理', emoji: '⏱️' },
  { id: 'category-soup-noodles', name: '湯及麵食', emoji: '🍜' },
  { id: 'category-breakfast', name: '早餐', emoji: '🍳' },
  { id: 'category-fitness', name: '健身及高蛋白餐', emoji: '🥗' },
  { id: 'category-dessert', name: '甜品', emoji: '🍰' },
  { id: 'category-other', name: '其他', emoji: '🍽️' },
];

type IngredientInput = [name: string, amount: number | null, unit: string, seasoning?: boolean, optional?: boolean];
function ingredients(recipe: string, rows: IngredientInput[]): Ingredient[] {
  return rows.map(([name, amount, unit, seasoning = false, optional = false], index) => ({ id: `${recipe}-ingredient-${index + 1}`, name, amount, unit, seasoning, optional }));
}

type SeedInput = Pick<Recipe, 'id' | 'title' | 'description' | 'image' | 'categoryId' | 'tags' | 'prepMinutes' | 'cookMinutes' | 'tool' | 'favorite' | 'notes'> & {
  ingredients: IngredientInput[];
  steps: { instruction: string; timerSeconds?: number }[];
};

const examples: SeedInput[] = [
  {
    id: 'demo-black-pepper-chicken', title: '港式黑椒雞腿扒',
    description: '茶餐廳的熟悉滋味。在家煎出外皮金黃、肉汁豐富的雞扒，配上洋蔥黑椒汁，一碗白飯就很滿足。',
    image: '/images/black-pepper-chicken.jpg', categoryId: 'category-hong-kong', tags: ['家常菜', '雞腿', '下飯'], prepMinutes: 15, cookMinutes: 20, tool: '平底鑊', favorite: true,
    notes: '雞扒煎好後先放置 3 分鐘再切，肉汁更容易保留。喜歡濃黑椒味可在上碟前再灑少量即磨黑椒。',
    ingredients: [['去骨雞腿扒', 2, '塊'], ['洋蔥', 0.5, '個'], ['蒜頭', 2, '瓣'], ['食油', 1, '湯匙'], ['生抽', 1, '湯匙', true], ['蠔油', 1, '湯匙', true], ['黑椒碎', 1, '茶匙', true], ['糖', 0.5, '茶匙', true], ['清水', 80, 'ml', true], ['粟粉', 1, '茶匙', true]],
    steps: [
      { instruction: '雞腿扒用廚房紙印乾。加入一半生抽和半茶匙黑椒碎，拌勻醃 10 分鐘。洋蔥切絲，蒜頭切碎。', timerSeconds: 600 },
      { instruction: '將其餘生抽、蠔油、糖、剩餘黑椒、清水及粟粉拌勻，備用。' },
      { instruction: '平底鑊下食油，以中火加熱。雞皮向下煎約 6–7 分鐘至金黃，再翻面煎約 5–6 分鐘。較厚位置需加長時間；用食物溫度計確認最厚位置達 75°C。', timerSeconds: 420 },
      { instruction: '雞扒盛起。在原鑊炒香蒜頭及洋蔥約 3 分鐘，倒入黑椒汁，拌煮至微滾濃稠。', timerSeconds: 180 },
      { instruction: '雞扒放回鑊中，均勻裹上黑椒汁，煮約 1 分鐘即可。切件後與白飯或蔬菜一起上碟。', timerSeconds: 60 },
    ],
  },
  {
    id: 'demo-ginger-chicken', title: '薑蔥雞腿肉',
    description: '薑絲與蔥段在熱鑊中散發香氣，雞腿肉嫩滑入味。材料簡單，是忙碌日子也能做好的家常小菜。',
    image: '/images/ginger-chicken.jpg', categoryId: 'category-chinese', tags: ['家常菜', '快手', '雞腿'], prepMinutes: 15, cookMinutes: 15, tool: '炒鑊', favorite: true,
    notes: '蔥白先下鑊炒香，蔥綠最後加入，能保持顏色和香氣。薑絲可以按喜好增加。',
    ingredients: [['去骨雞腿肉', 350, 'g'], ['薑', 25, 'g'], ['蔥', 3, '條'], ['蒜頭', 2, '瓣'], ['食油', 1, '湯匙'], ['生抽', 1, '湯匙', true], ['蠔油', 1, '湯匙', true], ['紹興酒', 1, '湯匙', true, true], ['粟粉', 1, '茶匙', true], ['糖', 0.5, '茶匙', true], ['清水', 40, 'ml', true]],
    steps: [
      { instruction: '雞腿肉切成約 3 cm 小塊，加入生抽、粟粉和糖拌勻，醃 10 分鐘。薑切絲，蒜切片，蔥切段並分開蔥白及蔥綠。', timerSeconds: 600 },
      { instruction: '炒鑊加入食油，以中大火炒香薑絲、蒜片及蔥白約 1 分鐘。', timerSeconds: 60 },
      { instruction: '加入雞腿肉，平鋪煎約 2 分鐘，再翻炒約 3 分鐘至表面變色。', timerSeconds: 180 },
      { instruction: '加入蠔油、紹興酒（如使用）及清水，拌勻後蓋上鑊蓋，以中火煮 4–5 分鐘。確認雞肉最厚位置達 75°C。', timerSeconds: 300 },
      { instruction: '加入蔥綠，炒勻約 30 秒。若汁太多，開蓋稍微收汁，再上碟。', timerSeconds: 30 },
    ],
  },
  {
    id: 'demo-eggplant', title: '魚香茄子',
    description: '沒有魚的魚香味，來自豆瓣醬、薑蒜和甜酸醬汁。柔軟茄子配上少量肉碎，香濃惹味又下飯。',
    image: '/images/eggplant.jpg', categoryId: 'category-chinese', tags: ['茄子', '下飯', '微辣'], prepMinutes: 15, cookMinutes: 20, tool: '炒鑊、蒸鍋', favorite: false,
    notes: '先蒸茄子能減少用油。豆瓣醬本身有鹹味，最後試味才決定是否補生抽；兒童版本可減半豆瓣醬。',
    ingredients: [['茄子', 2, '條'], ['豬肉碎', 100, 'g'], ['蒜頭', 3, '瓣'], ['薑', 10, 'g'], ['蔥', 1, '條'], ['食油', 1, '湯匙'], ['豆瓣醬', 1, '湯匙', true], ['生抽', 1, '茶匙', true], ['米醋', 2, '茶匙', true], ['糖', 1, '茶匙', true], ['清水', 100, 'ml', true], ['粟粉', 1, '茶匙', true]],
    steps: [
      { instruction: '茄子洗淨切成約 6 cm 長條。薑、蒜切碎，蔥切粒。生抽、米醋、糖、清水和粟粉拌勻成醬汁。' },
      { instruction: '水滾後把茄子放入蒸鍋，以大火蒸約 8 分鐘至軟，取出瀝去水分。', timerSeconds: 480 },
      { instruction: '炒鑊下油，以中火炒散肉碎約 3 分鐘至熟透。加入薑、蒜和豆瓣醬炒約 1 分鐘至香。', timerSeconds: 180 },
      { instruction: '加入茄子和拌勻的醬汁，輕輕翻拌，煮約 3–4 分鐘至汁濃。茄子容易碎，避免大力攪拌。', timerSeconds: 240 },
      { instruction: '試味後按喜好調整，灑上蔥花，上碟。肉碎須完全煮熟，可用食物溫度計確認達 75°C。' },
    ],
  },
  {
    id: 'demo-air-fryer-chicken', title: '氣炸鍋脆皮雞腿',
    description: '用少量油做出金黃脆皮雞腿。外皮香脆、內裡多汁，配沙律或焗薯就是輕鬆的一餐。',
    image: '/images/air-fryer-chicken.jpg', categoryId: 'category-air-fryer', tags: ['氣炸鍋', '雞腿', '高蛋白'], prepMinutes: 15, cookMinutes: 25, tool: '氣炸鍋', favorite: true,
    notes: '不同氣炸鍋的火力有差異，首次製作宜提早檢查。雞腿勿重疊；以溫度計確認熟度比只看顏色可靠。',
    ingredients: [['帶骨雞腿', 2, '隻'], ['橄欖油', 1, '茶匙'], ['鹽', 0.5, '茶匙', true], ['黑椒碎', 0.5, '茶匙', true], ['蒜粉', 1, '茶匙', true], ['紅椒粉', 1, '茶匙', true], ['檸檬', 0.5, '個', false, true]],
    steps: [
      { instruction: '雞腿用廚房紙印乾，較厚的肉位輕劃兩刀。將鹽、黑椒、蒜粉及紅椒粉混合。' },
      { instruction: '雞腿抹上橄欖油和混合調味料，醃約 10 分鐘。氣炸鍋以 180°C 預熱 3 分鐘。', timerSeconds: 600 },
      { instruction: '將雞腿單層放入炸籃，以 180°C 氣炸 12 分鐘。', timerSeconds: 720 },
      { instruction: '翻面，再以 180°C 氣炸約 10–12 分鐘。用食物溫度計量度最厚肉位（避開骨頭），須達 75°C；未達溫度便每次加煮 2 分鐘。', timerSeconds: 600 },
      { instruction: '若雞肉已熟而想增加脆度，可升至 200°C 再炸 1–2 分鐘，留意避免焦黑。取出靜置 3 分鐘，按喜好擠上檸檬汁。', timerSeconds: 180 },
    ],
  },
  {
    id: 'demo-teriyaki-chicken', title: '日式照燒雞',
    description: '甜鹹適中的照燒汁，包裹嫩滑雞腿扒。簡單幾種調味料，就能做出便當店的經典滋味。',
    image: '/images/teriyaki-chicken.jpg', categoryId: 'category-japanese', tags: ['日式', '便當', '雞腿'], prepMinutes: 10, cookMinutes: 20, tool: '平底鑊', favorite: false,
    notes: '味醂帶甜味，毋須再加太多糖。醬汁含糖，收汁時改用小火，避免煮焦。',
    ingredients: [['去骨雞腿扒', 2, '塊'], ['食油', 1, '茶匙'], ['白芝麻', 1, '茶匙', false, true], ['生抽', 2, '湯匙', true], ['味醂', 2, '湯匙', true], ['清酒', 1, '湯匙', true], ['糖', 1, '茶匙', true], ['清水', 2, '湯匙', true]],
    steps: [
      { instruction: '雞腿扒用廚房紙印乾，剪去多餘脂肪。把生抽、味醂、清酒、糖和清水拌勻作照燒汁。' },
      { instruction: '平底鑊下油，以中火加熱。雞皮向下煎 6–7 分鐘，至表面金黃，期間避免頻繁翻動。', timerSeconds: 420 },
      { instruction: '翻面，煎約 5–6 分鐘。最厚位置須達 75°C；較厚雞扒可蓋上鑊蓋稍煮，並再檢查熟度。', timerSeconds: 360 },
      { instruction: '用廚房紙小心吸去鑊內多餘油脂，倒入照燒汁，改用小火煮 2–3 分鐘，期間把醬汁淋在雞扒上。', timerSeconds: 180 },
      { instruction: '醬汁稍濃即可關火。雞扒靜置 3 分鐘後切件，淋上照燒汁，按喜好灑芝麻，配飯和蔬菜享用。', timerSeconds: 180 },
    ],
  },
  {
    id: 'demo-chicken-noodles', title: '雞腿湯麵',
    description: '一碗暖胃的家常湯麵，有嫩雞腿肉、蔬菜和清甜湯底。忙碌的晚上，也能吃得舒服又滿足。',
    image: '/images/chicken-noodles.jpg', categoryId: 'category-soup-noodles', tags: ['湯麵', '快手', '一鍋料理'], prepMinutes: 10, cookMinutes: 20, tool: '湯鍋', favorite: false,
    notes: '麵條另外煮再加入湯中，湯底會更清。可以換成烏冬、米粉或全麥麵，按包裝調整煮麵時間。',
    ingredients: [['去骨雞腿肉', 300, 'g'], ['麵條（乾）', 160, 'g'], ['小棠菜', 200, 'g'], ['甘筍', 0.5, '條'], ['薑', 3, '片'], ['低鹽雞湯', 700, 'ml'], ['清水', 200, 'ml'], ['蔥', 1, '條', false, true], ['生抽', 1, '茶匙', true], ['白胡椒粉', null, '適量', true], ['鹽', null, '適量', true, true]],
    steps: [
      { instruction: '雞腿肉切成約 3 cm 小塊，加入生抽拌勻。甘筍切薄片，小棠菜洗淨切半，蔥切粒。' },
      { instruction: '湯鍋加入雞湯、清水、薑片及甘筍，煮滾後轉中火煮 5 分鐘。', timerSeconds: 300 },
      { instruction: '加入雞腿肉，再滾後以中火煮約 8–10 分鐘。用食物溫度計確認雞肉最厚位置達 75°C。', timerSeconds: 600 },
      { instruction: '另鍋把水煮滾，按麵條包裝指示煮熟後瀝水。湯鍋加入小棠菜煮約 2 分鐘至軟。', timerSeconds: 120 },
      { instruction: '湯底加入少量白胡椒，試味後才按需要加鹽。麵條分放兩碗，加入雞肉、蔬菜及熱湯，灑上蔥花。' },
    ],
  },
];

export function createInitialData(): AppData {
  return {
    version: 1,
    categories: structuredClone(defaultCategories),
    recipes: examples.map((recipe, index) => ({
      ...recipe,
      tags: [...recipe.tags],
      ingredients: ingredients(recipe.id, recipe.ingredients),
      steps: recipe.steps.map((step, stepIndex) => ({ ...step, id: `${recipe.id}-step-${stepIndex + 1}` })),
      servings: 2, difficulty: '簡單' as const, sourceName: '原創示範食譜 · AI 生成示範圖片（非實際烹調照片）', sourceUrl: '',
      rating: 0, demo: true,
      createdAt: new Date(Date.UTC(2026, 9, 1 + index, 9)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 9, 1 + index, 9)).toISOString(),
    })),
    shopping: [], meals: [], cooking: {}, theme: 'light',
  };
}

export function createEmptyData(): AppData {
  return { version: 1, recipes: [], categories: [], shopping: [], meals: [], cooking: {}, theme: 'light' };
}
