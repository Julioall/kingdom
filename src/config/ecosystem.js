

export const WIDTH = 128, HEIGHT = 128, CELL_AREA_M2 = 100, REGION_SIDE = 8;

export const SEASONS = ['Primavera', 'Verão', 'Outono', 'Inverno'];

export const COLORS = ['#d47c51', '#718c56', '#647ca1', '#b2934f', '#8a6b91', '#4f8b85', '#a85b62', '#71806e'];

export const PLANTS = [
    { id: 'grass', name: 'Gramíneas', guild: 'Herbácea', color: '#91a74e', water: [.12, .82], temp: [-4, 39], max: 140, growth: .24, edible: 1, canopy: 0, habitat: 'land' },
    { id: 'berry', name: 'Arbusto de frutos', guild: 'Lenhosa baixa', color: '#76854a', water: [.28, .92], temp: [2, 36], max: 180, growth: .22, edible: .78, canopy: .12, habitat: 'land', foodFor: 'people' },
    { id: 'cultivated-root', name: 'Raízes cultivadas', guild: 'Cultivo comunitário', color: '#b4a353', water: [.18, .9], temp: [4, 36], max: 180, growth: 16.875, edible: 1, canopy: .04, habitat: 'land', foodFor: 'people', cultivatedOnly: true, rootReserve: 1.2 },
    { id: 'browse', name: 'Arbusto de brotos', guild: 'Lenhosa baixa', color: '#667d45', water: [.2, .86], temp: [-2, 38], max: 160, growth: .1215, edible: .62, canopy: .16, habitat: 'land', foodFor: 'sheep' },
    { id: 'broadleaf', name: 'Árvore de folhas largas', guild: 'Lenhosa', color: '#557543', water: [.32, .88], temp: [1, 35], max: 1200, growth: .42, edible: .08, canopy: .52, habitat: 'land' },
    { id: 'conifer', name: 'Conífera', guild: 'Lenhosa', color: '#355f4c', water: [.18, .76], temp: [-9, 27], max: 1100, growth: .34, edible: .03, canopy: .46, habitat: 'land' },
    { id: 'reed', name: 'Juncos', guild: 'Herbácea', color: '#a4a24f', water: [.74, 1], temp: [4, 39], max: 360, growth: 1.3, edible: .18, canopy: .04, habitat: 'shore' },
    { id: 'algae', name: 'Algas de água doce', guild: 'Aquática', color: '#4a8c80', water: [.9, 1], temp: [2, 34], max: 180, growth: .9, edible: .65, canopy: 0, habitat: 'water' }
  ];

export const ANIMALS = [
    { id: 'sheep', name: 'Ovelha', role: 'Herbívoro', color: '#e7e4d9', diet: ['grass', 'browse'], water: true, aquatic: false, speed: 1.0, mass: 48, life: 3900, food: 2.8, prey: [], huntable: true, catchability: .26 }
  ];

export const HUMAN_FOOD = ['berry', 'cultivated-root'];

export const SHEEP_FORAGE = ['grass', 'browse'];
export const SHEEP_ADULT_AGE_DAYS = 180;
export const SHEEP_NEWBORN_MASS_RATIO = .24;
export const SHEEP_JUVENILE_MIN_SCALE = .68;

// A small daily ration sustains a domesticated sheep without making the flock
// compete with people for the same edible plants.
export const DOMESTIC_SHEEP_DAILY_FEED = .12;
export const DOMESTIC_SHEEP_ENERGY_PER_FEED = 8;

export const HUMAN_NAMES = ['Aru', 'Bela', 'Caí', 'Dara', 'Eni', 'Iara', 'Jaci', 'Kai', 'Luma', 'Nilo', 'Oru', 'Tainá', 'Uira', 'Yara', 'Zuri', 'Ayo', 'Cora', 'Davi', 'Ema', 'Ivo', 'Lina', 'Mira', 'Noa', 'Ravi'];

export const NAME_LEFT = ['Água', 'Pedra', 'Junco', 'Serra', 'Mata', 'Vale', 'Capim', 'Vento', 'Lagoa', 'Lago'];

export const NAME_RIGHT = ['Clara', 'Alta', 'Verde', 'Manso', 'Dourada', 'Aberto', 'Fundo', 'Antigo', 'Sereno', 'Vivo'];

export const COMMUNITY_FORMS = ['Povo de ', 'Gente de ', 'Comunidade em ', 'Aliança de '];

export const PEOPLE_ACTIONS = ['forage', 'hunt', 'deliver', 'drink', 'socialize', 'rest', 'explore', 'build', 'gather', 'collect_log', 'collect_feed', 'share', 'trade', 'migrate', 'capture_sheep', 'lead_sheep', 'raid'];

export const ANIMAL_ACTIONS = ['feed', 'drink', 'hunt', 'rest', 'explore', 'flee'];

export const PEOPLE_INPUTS = 18, HIDDEN_NEURONS = 9, RULER_HIDDEN_NEURONS = 50;

export const FOOD_RESERVE_PER_UNIT = .72;
export const COMMUNITY_FOOD_CARRY_CAPACITY = 24;

export const DAILY_FOOD_NEED = .78;

export const MEAT_NUTRITIONAL_VALUE = 2.5;
