/**
 * DEBUG SCRIPT: Test Multiplier Calculation & Data Retrieval
 * Run with: NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... node test-multiplier-debug.js
 * Or just run: npm run test:multiplier
 */

const { createClient } = require('@supabase/supabase-js');

// Load .env manually if exists
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env.local');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=:#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Supabase config
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Set them via:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL=your_url NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key node test-multiplier-debug.js');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('✅ Connected to Supabase:', supabaseUrl.substring(0, 30) + '...');
console.log('');

// =====================================
// STEP 1: Check bet_placed table
// =====================================
async function checkBetPlacedTable() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 1: Checking bet_placed table');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const { data, error } = await supabase
      .from('bet_placed')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('❌ Error querying bet_placed:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No data found in bet_placed table');
      return null;
    }

    console.log(`✅ Found ${data.length} recent records in bet_placed:`);
    console.log('');
    
    data.forEach((bet, i) => {
      console.log(`Record ${i + 1}:`);
      console.log(`  timeperiod_id: ${bet.timeperiod_id}`);
      console.log(`  price_min: ${bet.price_min}`);
      console.log(`  price_max: ${bet.price_max}`);
      console.log(`  total_share: ${bet.total_share}`);
      console.log(`  grid_id: ${bet.grid_id}`);
      console.log('');
    });

    return data[0]; // Return first record for testing
  } catch (err) {
    console.error('❌ Exception:', err);
    return null;
  }
}

// =====================================
// STEP 2: Test fetchGridAndShares logic
// =====================================
async function testFetchGridAndShares(timeperiodId, priceMin, priceMax) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 2: Testing fetchGridAndShares()');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Input:');
  console.log(`  timeperiod_id: ${timeperiodId}`);
  console.log(`  price_min: ${priceMin}`);
  console.log(`  price_max: ${priceMax}`);
  console.log('');

  try {
    // Step 1: Find grid_id
    const { data: gridData, error: gridError } = await supabase
      .from('grid_created')
      .select('grid_id')
      .eq('timeperiod_id', timeperiodId)
      .eq('price_min', priceMin)
      .eq('price_max', priceMax)
      .limit(1)
      .maybeSingle();

    if (gridError) {
      console.error('❌ Error finding grid:', gridError);
      return null;
    }

    if (!gridData) {
      console.log('⚠️  No grid found in grid_created table');
      return null;
    }

    console.log(`✅ Found grid_id: ${gridData.grid_id}`);
    console.log('');

    // Step 2: Get total_share
    const { data: betPlacedData, error: betPlacedError } = await supabase
      .from('bet_placed')
      .select('total_share')
      .eq('timeperiod_id', timeperiodId)
      .eq('price_min', priceMin)
      .eq('price_max', priceMax)
      .maybeSingle();

    if (betPlacedError) {
      console.error('❌ Error fetching total_share:', betPlacedError);
      return null;
    }

    if (!betPlacedData || !betPlacedData.total_share) {
      console.log('⚠️  No total_share found in bet_placed table');
      return { gridId: gridData.grid_id, shares: 0 };
    }

    // Convert from Wei to decimal
    const totalShareRaw = betPlacedData.total_share;
    const totalShares = parseFloat(totalShareRaw) / 1e18;

    console.log('✅ Total shares retrieved:');
    console.log(`  Raw (Wei): ${totalShareRaw}`);
    console.log(`  Decimal: ${totalShares}`);
    console.log('');

    return { gridId: gridData.grid_id, shares: totalShares };
  } catch (err) {
    console.error('❌ Exception:', err);
    return null;
  }
}

// =====================================
// STEP 3: Test multiplier calculation
// =====================================
function testMultiplierCalculation(existingShares, timeperiodId) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 3: Testing Multiplier Calculation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const now = Math.floor(Date.now() / 1000);
  const timeUntilStart = timeperiodId - now;
  const BASE_B = 10000;

  console.log('Input:');
  console.log(`  Existing shares: ${existingShares}`);
  console.log(`  Timeperiod ID: ${timeperiodId}`);
  console.log(`  Current time: ${now}`);
  console.log(`  Time until start: ${timeUntilStart}s`);
  console.log('');

  // Determine base price
  let effectiveBasePrice = 0;
  if (existingShares === 0) {
    if (timeUntilStart <= 15) {
      effectiveBasePrice = 0.66;
    } else if (timeUntilStart > 15 && timeUntilStart <= 25) {
      effectiveBasePrice = 0.5;
    } else if (timeUntilStart > 25 && timeUntilStart <= 40) {
      effectiveBasePrice = 0.35;
    } else {
      effectiveBasePrice = 0.2;
    }
  } else {
    effectiveBasePrice = 0.2;
  }

  console.log(`Base price: ${effectiveBasePrice}`);

  // Calculate current price
  const currentPrice = effectiveBasePrice + (existingShares / BASE_B);
  console.log(`Current price: ${effectiveBasePrice} + (${existingShares} / ${BASE_B}) = ${currentPrice}`);

  // Calculate multiplier
  const multiplier = 1 / currentPrice;
  console.log(`Multiplier: 1 / ${currentPrice} = ${multiplier.toFixed(4)}x`);
  console.log('');

  return { multiplier, currentPrice, effectiveBasePrice, timeUntilStart };
}

// =====================================
// STEP 4: Test next user multiplier
// =====================================
function testNextUserMultiplier(existingShares, betAmount, timeperiodId) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 4: Testing Next User Multiplier');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const now = Math.floor(Date.now() / 1000);
  const timeUntilStart = timeperiodId - now;
  const BASE_B = 10000;

  console.log('Input:');
  console.log(`  Existing shares: ${existingShares}`);
  console.log(`  User bet amount: $${betAmount}`);
  console.log(`  Time until start: ${timeUntilStart}s`);
  console.log('');

  // Step 1: Calculate current user's shares
  let currentBasePrice = 0;
  if (existingShares === 0) {
    if (timeUntilStart <= 15) currentBasePrice = 0.66;
    else if (timeUntilStart > 15 && timeUntilStart <= 25) currentBasePrice = 0.5;
    else if (timeUntilStart > 25 && timeUntilStart <= 40) currentBasePrice = 0.35;
    else currentBasePrice = 0.2;
  } else {
    currentBasePrice = 0.2;
  }

  const currentPrice = currentBasePrice + (existingShares / BASE_B);
  const currentUserShares = betAmount / currentPrice;

  console.log(`Current user's price: ${currentPrice.toFixed(6)}`);
  console.log(`Current user's shares: ${betAmount} / ${currentPrice.toFixed(6)} = ${currentUserShares.toFixed(2)}`);
  console.log('');

  // Step 2: Calculate next user's multiplier
  const nextTotalShares = existingShares + currentUserShares;
  
  let nextBasePrice = 0;
  if (nextTotalShares === 0) {
    if (timeUntilStart <= 15) nextBasePrice = 0.66;
    else if (timeUntilStart > 15 && timeUntilStart <= 25) nextBasePrice = 0.5;
    else if (timeUntilStart > 25 && timeUntilStart <= 40) nextBasePrice = 0.35;
    else nextBasePrice = 0.2;
  } else {
    nextBasePrice = 0.2; // Reset when shares > 0
  }

  const nextPrice = nextBasePrice + (nextTotalShares / BASE_B);
  const nextMultiplier = 1 / nextPrice;

  console.log(`Next total shares: ${nextTotalShares.toFixed(2)}`);
  console.log(`Next user's price: ${nextPrice.toFixed(6)}`);
  console.log(`Next user's multiplier: 1 / ${nextPrice.toFixed(6)} = ${nextMultiplier.toFixed(4)}x`);
  console.log('');
  console.log(`🔴 RED MULTIPLIER: ${nextMultiplier.toFixed(2)}x`);
  console.log('');

  return nextMultiplier;
}

// =====================================
// MAIN EXECUTION
// =====================================
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  MULTIPLIER DEBUG & VERIFICATION TOOL    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Step 1: Check bet_placed table
  const sampleBet = await checkBetPlacedTable();
  
  if (!sampleBet) {
    console.log('⚠️  Cannot continue - no data found');
    process.exit(1);
  }

  // Step 2: Test fetchGridAndShares
  const result = await testFetchGridAndShares(
    sampleBet.timeperiod_id,
    sampleBet.price_min,
    sampleBet.price_max
  );

  if (!result) {
    console.log('⚠️  Cannot continue - fetch failed');
    process.exit(1);
  }

  // Step 3: Test multiplier calculation
  const multiplierResult = testMultiplierCalculation(
    result.shares,
    sampleBet.timeperiod_id
  );

  // Step 4: Test next user multiplier (assume $10 bet)
  const nextMultiplier = testNextUserMultiplier(
    result.shares,
    10, // $10 bet
    sampleBet.timeperiod_id
  );

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Data retrieval: WORKING`);
  console.log(`✅ Shares conversion: ${result.shares.toFixed(2)} shares`);
  console.log(`✅ Current multiplier: ${multiplierResult.multiplier.toFixed(2)}x`);
  console.log(`✅ Next user multiplier: ${nextMultiplier.toFixed(2)}x (RED)`);
  console.log('');
  console.log('If you don\'t see the RED multiplier in the UI:');
  console.log('1. Check browser console for errors');
  console.log('2. Verify nextUserMultiplier is calculated in calculateCellBetInfo()');
  console.log('3. Check that selected.nextUserMultiplier exists in render loop');
  console.log('4. Look for the RED fillStyle = "#FF4444" in canvas rendering');
  console.log('');
  console.log('✅ Debug test complete!');
}

main().catch(console.error);

