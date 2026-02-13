import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is not set");
  process.exit(1);
}

async function seedAncillaries() {
  const connection = await mysql.createConnection(DATABASE_URL);
  const db = drizzle(connection);

  console.log("[Seed] Starting ancillary services seed...");

  const services = [
    // Baggage
    {
      code: "BAG_20KG",
      category: "baggage",
      name: "20kg Checked Baggage",
      description: "Additional 20kg checked baggage allowance",
      price: 15000, // 150 SAR
      currency: "SAR",
      icon: "luggage",
      available: true,
    },
    {
      code: "BAG_30KG",
      category: "baggage",
      name: "30kg Checked Baggage",
      description: "Additional 30kg checked baggage allowance",
      price: 22000, // 220 SAR
      currency: "SAR",
      icon: "luggage",
      available: true,
    },
    {
      code: "BAG_SPORTS",
      category: "baggage",
      name: "Sports Equipment",
      description: "Special handling for sports equipment (golf, ski, etc.)",
      price: 30000, // 300 SAR
      currency: "SAR",
      icon: "dumbbell",
      available: true,
    },
    // Meals
    {
      code: "MEAL_REGULAR",
      category: "meal",
      name: "Regular Meal",
      description: "Standard in-flight meal",
      price: 5000, // 50 SAR
      currency: "SAR",
      icon: "utensils",
      available: true,
    },
    {
      code: "MEAL_VEGETARIAN",
      category: "meal",
      name: "Vegetarian Meal",
      description: "Vegetarian in-flight meal",
      price: 5000, // 50 SAR
      currency: "SAR",
      icon: "leaf",
      available: true,
    },
    {
      code: "MEAL_HALAL",
      category: "meal",
      name: "Halal Meal",
      description: "Halal-certified in-flight meal",
      price: 5000, // 50 SAR
      currency: "SAR",
      icon: "utensils",
      available: true,
    },
    {
      code: "MEAL_KIDS",
      category: "meal",
      name: "Kids Meal",
      description: "Special meal for children",
      price: 4000, // 40 SAR
      currency: "SAR",
      icon: "baby",
      available: true,
    },
    // Seats
    {
      code: "SEAT_EXTRA_LEG",
      category: "seat",
      name: "Extra Legroom Seat",
      description: "Seat with extra legroom for comfort",
      price: 10000, // 100 SAR
      currency: "SAR",
      icon: "armchair",
      applicableCabinClasses: JSON.stringify(["economy"]),
      available: true,
    },
    {
      code: "SEAT_FRONT_ROW",
      category: "seat",
      name: "Front Row Seat",
      description: "Priority seating in front rows",
      price: 8000, // 80 SAR
      currency: "SAR",
      icon: "armchair",
      available: true,
    },
    // Insurance
    {
      code: "INS_BASIC",
      category: "insurance",
      name: "Basic Travel Insurance",
      description: "Basic coverage for trip cancellation and delays",
      price: 7500, // 75 SAR
      currency: "SAR",
      icon: "shield",
      available: true,
    },
    {
      code: "INS_PREMIUM",
      category: "insurance",
      name: "Premium Travel Insurance",
      description: "Comprehensive coverage including medical and baggage",
      price: 15000, // 150 SAR
      currency: "SAR",
      icon: "shield-check",
      available: true,
    },
    // Lounge
    {
      code: "LOUNGE_ACCESS",
      category: "lounge",
      name: "Airport Lounge Access",
      description: "Access to premium airport lounge",
      price: 20000, // 200 SAR
      currency: "SAR",
      icon: "coffee",
      available: true,
    },
    // Priority Boarding
    {
      code: "PRIORITY_BOARD",
      category: "priority_boarding",
      name: "Priority Boarding",
      description: "Board the aircraft before general passengers",
      price: 5000, // 50 SAR
      currency: "SAR",
      icon: "plane-arrival",
      available: true,
    },
  ];

  try {
    // Check if services already exist
    const [existing] = await connection.query(
      "SELECT COUNT(*) as count FROM ancillary_services"
    );
    
    if (existing[0].count > 0) {
      console.log(`[Seed] Ancillary services already exist (${existing[0].count} services). Skipping seed.`);
      await connection.end();
      return;
    }

    // Insert services
    for (const service of services) {
      await connection.query(
        `INSERT INTO ancillary_services 
        (code, category, name, description, price, currency, icon, available, applicableCabinClasses, createdAt, updatedAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          service.code,
          service.category,
          service.name,
          service.description,
          service.price,
          service.currency,
          service.icon,
          service.available,
          service.applicableCabinClasses || null,
        ]
      );
    }

    console.log(`[Seed] Successfully seeded ${services.length} ancillary services`);
  } catch (error) {
    console.error("[Seed] Error seeding ancillary services:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

seedAncillaries()
  .then(() => {
    console.log("[Seed] Ancillary services seed completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[Seed] Seed failed:", error);
    process.exit(1);
  });
