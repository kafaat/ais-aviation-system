import { drizzle } from "drizzle-orm/mysql2";
import { airlines, airports, flights } from "../drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL);

async function seedData() {
  console.log("🌱 Starting database seeding...");

  try {
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
    ]);

    console.log("✅ Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

seedData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
