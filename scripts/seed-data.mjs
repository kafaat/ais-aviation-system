import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  airlines,
  airports,
  flights,
  currencies,
  ancillaryServices,
  pricingRules,
  seasonalPricing,
  aircraftTypes,
} from "../drizzle/schema.js";

// Create MySQL connection pool
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const url = new URL(connectionString);
const pool = mysql.createPool({
  host: url.hostname,
  port: parseInt(url.port || "3306", 10),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1), // Remove leading /
  waitForConnections: true,
  connectionLimit: 10,
});

const db = drizzle(pool);

async function seedData() {
  console.log("🌱 Starting database seeding...");

  try {
    // Clear existing data (in reverse order of dependencies)
    console.log("🧹 Clearing existing data...");
    await db.delete(seasonalPricing);
    await db.delete(pricingRules);
    await db.delete(ancillaryServices);
    await db.delete(currencies);
    await db.delete(flights);
    await db.delete(airports);
    await db.delete(airlines);
    await db.delete(aircraftTypes);
    console.log("✓ Existing data cleared");

    // Seed Airlines
    console.log("Adding airlines...");
    await db.insert(airlines).values([
      {
        code: "SV",
        name: "الخطوط السعودية",
        country: "Saudi Arabia",
        logo: "https://upload.wikimedia.org/wikipedia/en/thumb/4/43/Saudia_Logo.svg/200px-Saudia_Logo.svg.png",
        active: true,
      },
      {
        code: "MS",
        name: "مصر للطيران",
        country: "Egypt",
        logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/04/EgyptAir_Logo.svg/200px-EgyptAir_Logo.svg.png",
        active: true,
      },
      {
        code: "EK",
        name: "طيران الإمارات",
        country: "UAE",
        logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Emirates_logo.svg/200px-Emirates_logo.svg.png",
        active: true,
      },
      {
        code: "QR",
        name: "القطرية",
        country: "Qatar",
        logo: "https://upload.wikimedia.org/wikipedia/en/thumb/0/0b/Qatar_Airways_Logo.svg/200px-Qatar_Airways_Logo.svg.png",
        active: true,
      },
      {
        code: "IY",
        name: "اليمنية",
        country: "Yemen",
        logo: "https://upload.wikimedia.org/wikipedia/en/thumb/3/37/Yemenia_Logo.svg/200px-Yemenia_Logo.svg.png",
        active: true,
      },
      {
        code: "WY",
        name: "الطيران العُماني",
        country: "Oman",
        logo: "https://upload.wikimedia.org/wikipedia/en/thumb/b/b5/Oman_Air_Logo.svg/200px-Oman_Air_Logo.svg.png",
        active: true,
      },
    ]);

    // Seed Airports
    console.log("Adding airports...");
    await db.insert(airports).values([
      {
        code: "RUH",
        name: "مطار الملك خالد الدولي",
        city: "الرياض",
        country: "Saudi Arabia",
        timezone: "Asia/Riyadh",
      },
      {
        code: "JED",
        name: "مطار الملك عبدالعزيز الدولي",
        city: "جدة",
        country: "Saudi Arabia",
        timezone: "Asia/Riyadh",
      },
      {
        code: "DXB",
        name: "مطار دبي الدولي",
        city: "دبي",
        country: "UAE",
        timezone: "Asia/Dubai",
      },
      {
        code: "CAI",
        name: "مطار القاهرة الدولي",
        city: "القاهرة",
        country: "Egypt",
        timezone: "Africa/Cairo",
      },
      {
        code: "DOH",
        name: "مطار حمد الدولي",
        city: "الدوحة",
        country: "Qatar",
        timezone: "Asia/Qatar",
      },
      {
        code: "DMM",
        name: "مطار الملك فهد الدولي",
        city: "الدمام",
        country: "Saudi Arabia",
        timezone: "Asia/Riyadh",
      },
      {
        code: "SAH",
        name: "مطار صنعاء الدولي",
        city: "صنعاء",
        country: "Yemen",
        timezone: "Asia/Aden",
      },
      {
        code: "ADE",
        name: "مطار عدن الدولي",
        city: "عدن",
        country: "Yemen",
        timezone: "Asia/Aden",
      },
      {
        code: "MCT",
        name: "مطار مسقط الدولي",
        city: "مسقط",
        country: "Oman",
        timezone: "Asia/Muscat",
      },
    ]);

    // Seed Flights
    console.log("Adding flights...");
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    await db.insert(flights).values([
      // RUH to JED
      {
        flightNumber: "SV1234",
        airlineId: 1,
        originId: 1,
        destinationId: 2,
        departureTime: new Date(tomorrow.setHours(8, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(10, 30, 0, 0)),
        aircraftType: "Boeing 777",
        status: "scheduled",
        economySeats: 150,
        businessSeats: 30,
        economyPrice: 50000, // 500 SAR
        businessPrice: 150000, // 1500 SAR
        economyAvailable: 150,
        businessAvailable: 30,
      },
      // JED to CAI
      {
        flightNumber: "MS456",
        airlineId: 2,
        originId: 2,
        destinationId: 4,
        departureTime: new Date(tomorrow.setHours(14, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(16, 30, 0, 0)),
        aircraftType: "Airbus A320",
        status: "scheduled",
        economySeats: 120,
        businessSeats: 20,
        economyPrice: 80000, // 800 SAR
        businessPrice: 200000, // 2000 SAR
        economyAvailable: 120,
        businessAvailable: 20,
      },
      // RUH to DXB
      {
        flightNumber: "EK789",
        airlineId: 3,
        originId: 1,
        destinationId: 3,
        departureTime: new Date(tomorrow.setHours(18, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(20, 30, 0, 0)),
        aircraftType: "Boeing 787",
        status: "scheduled",
        economySeats: 180,
        businessSeats: 40,
        economyPrice: 70000, // 700 SAR
        businessPrice: 180000, // 1800 SAR
        economyAvailable: 180,
        businessAvailable: 40,
      },
      // JED to DOH
      {
        flightNumber: "QR321",
        airlineId: 4,
        originId: 2,
        destinationId: 5,
        departureTime: new Date(tomorrow.setHours(10, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(12, 0, 0, 0)),
        aircraftType: "Airbus A350",
        status: "scheduled",
        economySeats: 160,
        businessSeats: 35,
        economyPrice: 60000, // 600 SAR
        businessPrice: 170000, // 1700 SAR
        economyAvailable: 160,
        businessAvailable: 35,
      },
      // DMM to RUH
      {
        flightNumber: "SV567",
        airlineId: 1,
        originId: 6,
        destinationId: 1,
        departureTime: new Date(tomorrow.setHours(16, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(17, 30, 0, 0)),
        aircraftType: "Boeing 737",
        status: "scheduled",
        economySeats: 140,
        businessSeats: 25,
        economyPrice: 40000, // 400 SAR
        businessPrice: 120000, // 1200 SAR
        economyAvailable: 140,
        businessAvailable: 25,
      },
      // JED to SAH (Jeddah to Sanaa)
      {
        flightNumber: "IY601",
        airlineId: 5,
        originId: 2,
        destinationId: 7,
        departureTime: new Date(tomorrow.setHours(9, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(11, 30, 0, 0)),
        aircraftType: "Airbus A320",
        status: "scheduled",
        economySeats: 120,
        businessSeats: 20,
        economyPrice: 45000, // 450 SAR
        businessPrice: 130000, // 1300 SAR
        economyAvailable: 120,
        businessAvailable: 20,
      },
      // SAH to JED (Sanaa to Jeddah)
      {
        flightNumber: "IY602",
        airlineId: 5,
        originId: 7,
        destinationId: 2,
        departureTime: new Date(tomorrow.setHours(13, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(15, 30, 0, 0)),
        aircraftType: "Airbus A320",
        status: "scheduled",
        economySeats: 120,
        businessSeats: 20,
        economyPrice: 45000, // 450 SAR
        businessPrice: 130000, // 1300 SAR
        economyAvailable: 120,
        businessAvailable: 20,
      },
      // JED to ADE (Jeddah to Aden)
      {
        flightNumber: "IY603",
        airlineId: 5,
        originId: 2,
        destinationId: 8,
        departureTime: new Date(tomorrow.setHours(7, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(9, 30, 0, 0)),
        aircraftType: "Boeing 737",
        status: "scheduled",
        economySeats: 130,
        businessSeats: 20,
        economyPrice: 42000, // 420 SAR
        businessPrice: 125000, // 1250 SAR
        economyAvailable: 130,
        businessAvailable: 20,
      },
      // ADE to JED (Aden to Jeddah)
      {
        flightNumber: "IY604",
        airlineId: 5,
        originId: 8,
        destinationId: 2,
        departureTime: new Date(tomorrow.setHours(11, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(13, 30, 0, 0)),
        aircraftType: "Boeing 737",
        status: "scheduled",
        economySeats: 130,
        businessSeats: 20,
        economyPrice: 42000, // 420 SAR
        businessPrice: 125000, // 1250 SAR
        economyAvailable: 130,
        businessAvailable: 20,
      },
      // SAH to ADE (Sanaa to Aden - domestic Yemen)
      {
        flightNumber: "IY210",
        airlineId: 5,
        originId: 7,
        destinationId: 8,
        departureTime: new Date(tomorrow.setHours(6, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(7, 15, 0, 0)),
        aircraftType: "Boeing 737",
        status: "scheduled",
        economySeats: 130,
        businessSeats: 20,
        economyPrice: 25000, // 250 SAR
        businessPrice: 80000, // 800 SAR
        economyAvailable: 130,
        businessAvailable: 20,
      },
      // RUH to MCT (Riyadh to Muscat)
      {
        flightNumber: "WY812",
        airlineId: 6,
        originId: 1,
        destinationId: 9,
        departureTime: new Date(tomorrow.setHours(10, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(12, 30, 0, 0)),
        aircraftType: "Boeing 787",
        status: "scheduled",
        economySeats: 180,
        businessSeats: 30,
        economyPrice: 55000, // 550 SAR
        businessPrice: 160000, // 1600 SAR
        economyAvailable: 180,
        businessAvailable: 30,
      },
      // MCT to RUH (Muscat to Riyadh)
      {
        flightNumber: "WY813",
        airlineId: 6,
        originId: 9,
        destinationId: 1,
        departureTime: new Date(tomorrow.setHours(15, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(17, 0, 0, 0)),
        aircraftType: "Boeing 787",
        status: "scheduled",
        economySeats: 180,
        businessSeats: 30,
        economyPrice: 55000, // 550 SAR
        businessPrice: 160000, // 1600 SAR
        economyAvailable: 180,
        businessAvailable: 30,
      },
      // JED to MCT (Jeddah to Muscat)
      {
        flightNumber: "WY814",
        airlineId: 6,
        originId: 2,
        destinationId: 9,
        departureTime: new Date(tomorrow.setHours(12, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(15, 30, 0, 0)),
        aircraftType: "Airbus A330",
        status: "scheduled",
        economySeats: 170,
        businessSeats: 30,
        economyPrice: 65000, // 650 SAR
        businessPrice: 175000, // 1750 SAR
        economyAvailable: 170,
        businessAvailable: 30,
      },
      // MCT to DXB (Muscat to Dubai)
      {
        flightNumber: "WY607",
        airlineId: 6,
        originId: 9,
        destinationId: 3,
        departureTime: new Date(tomorrow.setHours(8, 0, 0, 0)),
        arrivalTime: new Date(tomorrow.setHours(9, 0, 0, 0)),
        aircraftType: "Boeing 737",
        status: "scheduled",
        economySeats: 140,
        businessSeats: 25,
        economyPrice: 30000, // 300 SAR
        businessPrice: 90000, // 900 SAR
        economyAvailable: 140,
        businessAvailable: 25,
      },
    ]);

    // Seed Currencies
    console.log("Adding currencies...");
    await db.insert(currencies).values([
      {
        code: "SAR",
        name: "Saudi Riyal",
        nameAr: "ريال سعودي",
        symbol: "﷼",
        decimalPlaces: 2,
        symbolPosition: "after",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: true,
      },
      {
        code: "USD",
        name: "US Dollar",
        nameAr: "دولار أمريكي",
        symbol: "$",
        decimalPlaces: 2,
        symbolPosition: "before",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: false,
      },
      {
        code: "EUR",
        name: "Euro",
        nameAr: "يورو",
        symbol: "€",
        decimalPlaces: 2,
        symbolPosition: "before",
        thousandsSeparator: ".",
        decimalSeparator: ",",
        isActive: true,
        isBaseCurrency: false,
      },
      {
        code: "AED",
        name: "UAE Dirham",
        nameAr: "درهم إماراتي",
        symbol: "د.إ",
        decimalPlaces: 2,
        symbolPosition: "after",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: false,
      },
      {
        code: "EGP",
        name: "Egyptian Pound",
        nameAr: "جنيه مصري",
        symbol: "ج.م",
        decimalPlaces: 2,
        symbolPosition: "after",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: false,
      },
      {
        code: "YER",
        name: "Yemeni Rial",
        nameAr: "ريال يمني",
        symbol: "﷼",
        decimalPlaces: 2,
        symbolPosition: "after",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: false,
      },
      {
        code: "OMR",
        name: "Omani Rial",
        nameAr: "ريال عُماني",
        symbol: "ر.ع.",
        decimalPlaces: 3,
        symbolPosition: "after",
        thousandsSeparator: ",",
        decimalSeparator: ".",
        isActive: true,
        isBaseCurrency: false,
      },
    ]);

    // Seed Ancillary Services
    console.log("Adding ancillary services...");
    await db.insert(ancillaryServices).values([
      // Baggage
      {
        code: "BAG_20KG",
        category: "baggage",
        name: "20kg Checked Baggage",
        description: "Additional 20kg checked baggage allowance",
        price: 15000, // 150 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy", "business"]),
        icon: "luggage",
      },
      {
        code: "BAG_30KG",
        category: "baggage",
        name: "30kg Checked Baggage",
        description: "Additional 30kg checked baggage allowance",
        price: 25000, // 250 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy", "business"]),
        icon: "luggage",
      },
      // Meals
      {
        code: "MEAL_STD",
        category: "meal",
        name: "Standard Meal",
        description: "Hot meal with drink",
        price: 5000, // 50 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "utensils",
      },
      {
        code: "MEAL_VEG",
        category: "meal",
        name: "Vegetarian Meal",
        description: "Vegetarian hot meal with drink",
        price: 5000, // 50 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "leaf",
      },
      {
        code: "MEAL_HALAL",
        category: "meal",
        name: "Halal Meal",
        description: "Halal certified hot meal with drink",
        price: 5000, // 50 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "utensils",
      },
      // Seats
      {
        code: "SEAT_EXTRA_LEG",
        category: "seat",
        name: "Extra Legroom Seat",
        description: "Seat with additional legroom",
        price: 10000, // 100 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "armchair",
      },
      {
        code: "SEAT_WINDOW",
        category: "seat",
        name: "Window Seat",
        description: "Guaranteed window seat",
        price: 3000, // 30 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "window",
      },
      // Lounge
      {
        code: "LOUNGE_ACCESS",
        category: "lounge",
        name: "Lounge Access",
        description: "Access to airport lounge",
        price: 20000, // 200 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "sofa",
      },
      // Priority Boarding
      {
        code: "PRIORITY_BOARD",
        category: "priority_boarding",
        name: "Priority Boarding",
        description: "Board the aircraft before other passengers",
        price: 5000, // 50 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy"]),
        icon: "fast-forward",
      },
      // Insurance
      {
        code: "TRAVEL_INS",
        category: "insurance",
        name: "Travel Insurance",
        description: "Comprehensive travel insurance coverage",
        price: 8000, // 80 SAR
        currency: "SAR",
        available: true,
        applicableCabinClasses: JSON.stringify(["economy", "business"]),
        icon: "shield",
      },
    ]);

    // Seed Pricing Rules
    console.log("Adding pricing rules...");
    await db.insert(pricingRules).values([
      {
        name: "High Demand Multiplier",
        description: "Increase prices when demand is high (>80% occupancy)",
        ruleType: "load_factor",
        parameters: JSON.stringify({
          thresholds: [
            { occupancy: 0.8, multiplier: 1.15 },
            { occupancy: 0.9, multiplier: 1.3 },
            { occupancy: 0.95, multiplier: 1.5 },
          ],
        }),
        priority: 10,
        isActive: true,
      },
      {
        name: "Advance Purchase Discount",
        description: "Lower prices for early bookings",
        ruleType: "advance_purchase",
        parameters: JSON.stringify({
          thresholds: [
            { daysBeforeDeparture: 30, multiplier: 0.85 },
            { daysBeforeDeparture: 14, multiplier: 0.95 },
            { daysBeforeDeparture: 7, multiplier: 1.0 },
            { daysBeforeDeparture: 3, multiplier: 1.15 },
            { daysBeforeDeparture: 1, multiplier: 1.25 },
          ],
        }),
        priority: 5,
        isActive: true,
      },
      {
        name: "Business Class Premium",
        description: "Premium pricing for business class",
        ruleType: "cabin_class",
        cabinClass: "business",
        parameters: JSON.stringify({
          baseMultiplier: 3.0,
        }),
        priority: 1,
        isActive: true,
      },
    ]);

    // Seed Seasonal Pricing
    console.log("Adding seasonal pricing...");
    const currentYear = new Date().getFullYear();
    await db.insert(seasonalPricing).values([
      {
        name: "Hajj Season",
        nameAr: "موسم الحج",
        startDate: new Date(`${currentYear}-06-01`),
        endDate: new Date(`${currentYear}-07-15`),
        multiplier: "1.50",
        isActive: true,
      },
      {
        name: "Ramadan",
        nameAr: "رمضان",
        startDate: new Date(`${currentYear}-03-01`),
        endDate: new Date(`${currentYear}-04-10`),
        multiplier: "1.20",
        isActive: true,
      },
      {
        name: "Summer Peak",
        nameAr: "ذروة الصيف",
        startDate: new Date(`${currentYear}-07-15`),
        endDate: new Date(`${currentYear}-08-31`),
        multiplier: "1.25",
        isActive: true,
      },
      {
        name: "National Day",
        nameAr: "اليوم الوطني",
        startDate: new Date(`${currentYear}-09-20`),
        endDate: new Date(`${currentYear}-09-25`),
        multiplier: "1.15",
        isActive: true,
      },
    ]);

    // Seed Aircraft Types
    console.log("Adding aircraft types...");
    await db.insert(aircraftTypes).values([
      {
        code: "A320",
        name: "Airbus A320-200",
        manufacturer: "Airbus",
        maxTakeoffWeight: 78000,
        maxLandingWeight: 66000,
        maxZeroFuelWeight: 62500,
        operatingEmptyWeight: 42600,
        maxPayload: 19900,
        maxFuelCapacity: 24210,
        totalSeats: 140,
        economySeats: 120,
        businessSeats: 20,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 3402 },
          { zone: "AFT", maxWeight: 2670 },
          { zone: "BULK", maxWeight: 1497 },
        ]),
        forwardCgLimit: "17.00",
        aftCgLimit: "40.00",
        active: true,
      },
      {
        code: "A330",
        name: "Airbus A330-300",
        manufacturer: "Airbus",
        maxTakeoffWeight: 242000,
        maxLandingWeight: 187000,
        maxZeroFuelWeight: 178000,
        operatingEmptyWeight: 124500,
        maxPayload: 53500,
        maxFuelCapacity: 139090,
        totalSeats: 200,
        economySeats: 170,
        businessSeats: 30,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 11340 },
          { zone: "AFT", maxWeight: 8845 },
          { zone: "BULK", maxWeight: 1588 },
        ]),
        forwardCgLimit: "14.00",
        aftCgLimit: "38.00",
        active: true,
      },
      {
        code: "A350",
        name: "Airbus A350-900",
        manufacturer: "Airbus",
        maxTakeoffWeight: 280000,
        maxLandingWeight: 205000,
        maxZeroFuelWeight: 192000,
        operatingEmptyWeight: 142400,
        maxPayload: 49600,
        maxFuelCapacity: 141000,
        totalSeats: 195,
        economySeats: 160,
        businessSeats: 35,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 13600 },
          { zone: "AFT", maxWeight: 10200 },
          { zone: "BULK", maxWeight: 2268 },
        ]),
        forwardCgLimit: "15.00",
        aftCgLimit: "39.00",
        active: true,
      },
      {
        code: "B737",
        name: "Boeing 737-800",
        manufacturer: "Boeing",
        maxTakeoffWeight: 79016,
        maxLandingWeight: 66361,
        maxZeroFuelWeight: 62732,
        operatingEmptyWeight: 41413,
        maxPayload: 21319,
        maxFuelCapacity: 26020,
        totalSeats: 165,
        economySeats: 140,
        businessSeats: 25,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 3468 },
          { zone: "AFT", maxWeight: 3100 },
          { zone: "BULK", maxWeight: 1270 },
        ]),
        forwardCgLimit: "15.00",
        aftCgLimit: "37.50",
        active: true,
      },
      {
        code: "B777",
        name: "Boeing 777-300ER",
        manufacturer: "Boeing",
        maxTakeoffWeight: 351534,
        maxLandingWeight: 251290,
        maxZeroFuelWeight: 237680,
        operatingEmptyWeight: 167829,
        maxPayload: 69851,
        maxFuelCapacity: 181283,
        totalSeats: 180,
        economySeats: 150,
        businessSeats: 30,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 17500 },
          { zone: "AFT", maxWeight: 14000 },
          { zone: "BULK", maxWeight: 3000 },
        ]),
        forwardCgLimit: "14.00",
        aftCgLimit: "38.00",
        active: true,
      },
      {
        code: "B787",
        name: "Boeing 787-9 Dreamliner",
        manufacturer: "Boeing",
        maxTakeoffWeight: 254011,
        maxLandingWeight: 192778,
        maxZeroFuelWeight: 181437,
        operatingEmptyWeight: 128850,
        maxPayload: 52587,
        maxFuelCapacity: 126917,
        totalSeats: 210,
        economySeats: 180,
        businessSeats: 30,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 12000 },
          { zone: "AFT", maxWeight: 9500 },
          { zone: "BULK", maxWeight: 2000 },
        ]),
        forwardCgLimit: "14.50",
        aftCgLimit: "38.50",
        active: true,
      },
      {
        code: "B727",
        name: "Boeing 727-200",
        manufacturer: "Boeing",
        maxTakeoffWeight: 95028,
        maxLandingWeight: 72575,
        maxZeroFuelWeight: 62369,
        operatingEmptyWeight: 45360,
        maxPayload: 17009,
        maxFuelCapacity: 30620,
        totalSeats: 149,
        economySeats: 134,
        businessSeats: 15,
        cargoZones: JSON.stringify([
          { zone: "FWD", maxWeight: 2700 },
          { zone: "AFT", maxWeight: 2200 },
          { zone: "BULK", maxWeight: 1100 },
        ]),
        forwardCgLimit: "16.00",
        aftCgLimit: "36.00",
        active: true,
      },
    ]);

    console.log("✅ Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

seedData()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async () => {
    await pool.end();
    process.exit(1);
  });
