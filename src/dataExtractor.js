import usdcEth from "../abis/usdcEth.json" assert { type: "json" };
import dotenv from "dotenv";
dotenv.config();
import { ethers } from "ethers";

import Bottleneck from "bottleneck";
import cliProgress from "cli-progress";
import readline from "readline";
import pkg from "pg";

const { Client } = pkg;
// Initialize PostgreSQL client
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  application_name: "UniswapV3Extractor",
  options: "-c search_path=uniswapv3usdcweth",
});

client.connect();

// Function to create the table if it doesn't exist

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS public.swap_events (
    block_number INTEGER NOT NULL,
    transaction_hash TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    weth DECIMAL NOT NULL,
    usdc DECIMAL NOT NULL,
    sqrt_price_x96 NUMERIC NOT NULL,
    liquidity DECIMAL NOT NULL,
    tick INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_swap_events_block_number ON public.swap_events (block_number);
`;

async function createTable() {
  try {
    await client.query(createTableQuery);
    console.log("Table created successfully!");
  } catch (err) {
    console.error("Error creating table:", err);
  }
}

// Load rate limits and chunk sizes from the environment
const RATE_LIMITS = JSON.parse(process.env.RATE_LIMITS || "[]");
const CHUNK_SIZES = JSON.parse(process.env.CHUNK_SIZES || "[]");
const MAX_CONCURRENT = JSON.parse(process.env.MAX_CONCURRENT || "[]");
const wsUrls = JSON.parse(process.env.WEBSOCKET_URLS || "[]");

/*
console.log("RATE_LIMITS: ", RATE_LIMITS);
console.log("CHUNK_SIZES: ", CHUNK_SIZES);
console.log("MAX_CONCURRENT: ", MAX_CONCURRENT);
console.log("WEBSOCKET_URLS: ", wsUrls);
*/

if (
  wsUrls.length !== RATE_LIMITS.length ||
  wsUrls.length !== CHUNK_SIZES.length ||
  wsUrls.length !== MAX_CONCURRENT.length
) {
  throw new Error(
    "WEBSOCKET_URLS, RATE_LIMITS, CHUNK_SIZES, and MAX_CONCURRENT must have the same length"
  );
}

const providers = wsUrls.map((url, index) => ({
  provider: new ethers.WebSocketProvider(url),
  //rateLimit: RATE_LIMITS[index],
  chunkSize: CHUNK_SIZES[index],
  limiter: new Bottleneck({
    minTime: RATE_LIMITS[index],
    maxConcurrent: MAX_CONCURRENT[index],
  }),
  rateLimit: RATE_LIMITS[index],
  maxConcurrent: MAX_CONCURRENT[index],
  name: `Provider ${index}`,
}));

const contractAddress = usdcEth.addressPolygon;
const contractABI = usdcEth.abiPolygon;

const contracts = providers.map(
  ({ provider }) => new ethers.Contract(contractAddress, contractABI, provider)
);

console.log("\nSuccessfully connected to the contracts!\n");

const latestBlock = await providers[0].provider.getBlockNumber();

// Memory threshold is not synced with the actual memory usage. Please look at package.json for predefined memory allocations.
const MEMORY_THRESHOLD =
  process.env.RAM_ALLOCATION * 0.85 * (1024 * 1024 * 1024); // 85% of x GB

function bigIntToNumber(value) {
  try {
    const num = Number(ethers.formatEther(value)) * 1e18;
    if (isNaN(num)) {
      throw new Error(`Conversion resulted in NaN for value: ${value}`);
    }
    return num;
  } catch (error) {
    console.error("Error converting bigInt to number:", error, value);
    return NaN;
  }
}

function calculatePrice(tick) {
  if (isNaN(tick)) {
    throw new Error(`Invalid tick value: ${tick}`);
  }

  const weth = (Math.pow(1.0001, tick) / 1e-44) * 1e-56;
  const usdc = 1 / weth;
  return { weth, usdc };
}

function calculateMedianTick(ticks) {
  const sortedTicks = ticks.sort((a, b) => a - b);
  const length = sortedTicks.length;
  const mid = Math.floor(length / 2);
  return length % 2 !== 0
    ? sortedTicks[mid]
    : (sortedTicks[mid - 1] + sortedTicks[mid]) / 2;
}

function getSwapTicks(events) {
  return events.map((event) => {
    const tick = event.args.tick;

    return Number(ethers.formatEther(tick)) * 1e18;
  });
}

function getRange(medianPrice, percentageBounds = 0.1) {
  if (typeof percentageBounds === "string") {
    percentageBounds = parseFloat(percentageBounds);
  }
  return {
    lower: medianPrice * (1 - percentageBounds),
    upper: medianPrice * (1 + percentageBounds),
  };
}

// Handled for even chunk distributions, not odd
async function getSwapEvents(
  index,
  startBlock,
  endBlock,
  processChunk,
  progressBar
) {
  const filter = contracts[index].filters.Swap();

  // Error handling for invalid block range
  if (startBlock > endBlock) {
    throw new Error("startBlock cannot be greater than endBlock.");
  }

  for (
    let currentEndBlock = endBlock;
    currentEndBlock >= startBlock;
    currentEndBlock -= providers[index].chunkSize
  ) {
    const currentStartBlock = Math.max(
      currentEndBlock - providers[index].chunkSize + 1,
      startBlock
    );
    const events = await providers[index].limiter.schedule(() =>
      contracts[index].queryFilter(filter, currentStartBlock, currentEndBlock)
    );
    //console.log(currentStartBlock, " ", currentEndBlock);

    events.sort((a, b) => b.blockNumber - a.blockNumber);
    const blocksTraversed = currentEndBlock - currentStartBlock + 1;

    //console.log("Blocks traversed: ", blocksTraversed);
    await processChunk(events, blocksTraversed);

    const heapUsedInBytes = process.memoryUsage().heapUsed;
    const heapUsedInMegabytes = (heapUsedInBytes / (1024 * 1024)).toFixed(2);
    progressBar.increment(0, { heapUsed: heapUsedInMegabytes });
  }
}

async function processSwapEventsInChunks(
  index,
  events,
  //priceRange,
  progressBar
) {
  const blockNumbers = Array.from(
    new Set(events.map((event) => event.blockNumber))
  );
  const blockTimestamps = await getBlockTimestamps(
    index,
    blockNumbers,
    progressBar
  );

  const structuredEvents = events.map((event) => {
    const block_number = event.blockNumber;
    const transaction_hash = event.transactionHash;
    const timestamp = new Date(
      blockTimestamps[block_number] * 1000
    ).toISOString();
    const amount0 = event.args.amount0;
    const amount1 = event.args.amount1;
    const sqrtPriceX96 = event.args.sqrtPriceX96;
    const liquidity = event.args.liquidity;
    const tick = event.args.tick;

    return {
      block_number,
      transaction_hash,
      timestamp,
      usdc: bigIntToNumber(amount0) * 1e-6,
      weth: bigIntToNumber(amount1) * 1e-18,
      sqrtPriceX96: /*bigIntToNumber(sqrtPriceX96)*/ Number(
        ethers.formatEther(sqrtPriceX96)
      ),
      liquidity: bigIntToNumber(liquidity) /* 1e-18*/,
      tick: bigIntToNumber(tick),
    };
  });
  const heapUsedInBytes = process.memoryUsage().heapUsed;
  const heapUsedInMegabytes = (heapUsedInBytes / (1024 * 1024)).toFixed(2);
  progressBar.increment(0, {
    heapUsed: heapUsedInMegabytes,
  });
  return {
    structuredEvents: structuredEvents.filter((event) => event !== null),
    filteredEventsCount: events.length,
  };
}

async function getBlockTimestamps(index, blockNumbers, progressBar) {
  const blockTimestamps = {};
  //progressBar.start(blockNumbers.length, 0);

  await Promise.all(
    blockNumbers.map((blockNumber) =>
      providers[index].limiter.schedule(() =>
        providers[index].provider.getBlock(blockNumber).then((block) => {
          blockTimestamps[blockNumber] = block.timestamp;
          const heapUsedInBytes = process.memoryUsage().heapUsed;
          const heapUsedInMegabytes = (heapUsedInBytes / (1024 * 1024)).toFixed(
            2
          );
          progressBar.increment(0, { heapUsed: heapUsedInMegabytes });
        })
      )
    )
  );

  //progressBar.stop();
  return blockTimestamps;
}

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
/*
TODO:
- Make progress bars span all blocks, not each chunk
- Make both progress bars show up at the same time
*/
async function main() {
  try {
    await createTable(); // Create the table before processing events

    /*let blocksBackForPrice = await askQuestion(
      "Please enter how many blocks back we should use to derive the median ETH price: "
    );*/
    let blocksBack = await askQuestion(
      "Please enter how many blocks back for swaps: "
    );
    /*let percentageBounds = await askQuestion(
      "Please enter the percentage bounds (for e.g., .10, which means 10% above and below the current price): "
    );*/

    //let blocksBackForPrice = parseInt(blocksBackForPrice) || 10000;
    if (blocksBack === "genesis") blocksBack = latestBlock;
    else blocksBack = parseInt(blocksBack) || 50000;

    //console.log("blocksBackForPrice: ", blocksBackForPrice);
    console.log("blocksBack: ", blocksBack);

    rl.close();

    const startTime = Date.now();
    //const priceMedianBlockLimit = latestBlock - blocksBackForPrice;
    const ticks = [];
    const runId = Date.now();
    /*const newRun = {
      runId: runId,
      timestamp: new Date(startTime).toString(),
      currentBlock: latestBlock,
      blocksBackForPriceMedian: blocksBackForPrice,
      blocksBackForSwapData: blocksBack,
      duration: 0,
      ticksUsedForMedian: 0,
      totalEvents: 0,
      eventsInPriceRange: 0,
      medianPrice: {},
      priceRange: {},
      swaps: [],
    };*/

    let eventsProcessed = 0;
    //let usdcRange = { lower: 0, upper: 0 };
    console.log("Fetching and processing swap events...\n");
    // Initialize multi-bar
    const multiBar = new cliProgress.MultiBar(
      {
        format:
          "Progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Blocks | Heap used: {heapUsed} MB",
      },
      cliProgress.Presets.shades_classic
    );
    // Calculate proportional work shares

    // Still need to account for chunk sizes and maxConcurrent
    const totalInverseRateLimit = providers.reduce(
      (total, { rateLimit }) => total + 1 / rateLimit,
      0
    );
    console.log("Total inverse rate limit: ", totalInverseRateLimit);
    const workShares = providers.map(
      ({ rateLimit }) => 1 / rateLimit / totalInverseRateLimit
    );
    console.log("Work shares: ", workShares);

    // Distribute blocks based on work shares and custom chunk sizes
    // 200k - 150k = 50k start block
    // 150001 to 200k
    // 100001 to 150k
    // 50001 to 100k and 50k to 50k
    // Currently excludes the start block, 200k-150k = 50k + 1 = 50001 start block
    console.log("Latest block: ", latestBlock);
    let currentEndBlock = latestBlock;
    const blockRanges = providers.map(({ chunkSize }, index) => {
      // 150k * 1/3 = 50k; 50k; 50k
      const blocksForProvider = Math.ceil(blocksBack * workShares[index]);
      // 200k - 50k = 150k + 1 = 150001; 150k - 50k + 1 = 100001; 100k - 50k + 1 = 50001
      let providerStartBlock = Math.max(
        currentEndBlock - blocksForProvider + 1,
        0
      );

      // 200k; 150k; 100k
      const providerEndBlock = currentEndBlock;
      // 150001 - 1 = 150k; 100001 - 1 = 100k; 50001 - 1 = 50k
      currentEndBlock = providerStartBlock - 1; // Update for the next provider

      // Ensure the last provider includes the oldest block in the range
      if (index === providers.length - 1) {
        providerStartBlock = Math.max(latestBlock - blocksBack, 0);
      }

      console.log(
        `Provider ${
          index + 1
        }: startBlock = ${providerStartBlock}, endBlock = ${providerEndBlock}`
      );

      return {
        chunkSize,
        startBlock: providerStartBlock,
        endBlock: providerEndBlock,
      };
      return {
        chunkSize,
        startBlock: providerStartBlock,
        endBlock: providerEndBlock,
      };
    });

    const promises = providers.map(({}, index) => {
      const { chunkSizeIgnore, startBlock, endBlock } = blockRanges[index];
      // Create a progress bar for the provider
      const totalBlocks = endBlock - startBlock + 1;
      //console.log("Total blocks: ", totalBlocks);
      const progressBar = multiBar.create(totalBlocks, 0, {
        heapUsed: 0,
        memoryThreshold: (MEMORY_THRESHOLD / (1024 * 1024)).toFixed(2),
      });
      try {
        return getSwapEvents(
          index,
          startBlock,
          endBlock,
          async (chunk, blocksTraversed) => {
            eventsProcessed += chunk.length;
            //console.log("Block number: ", chunk[0].blockNumber);
            /*const filteredEventsForMedian = chunk.filter(
              (event) => event.blockNumber >= priceMedianBlockLimit
            );
            if (filteredEventsForMedian.length !== 0) {
              ticks.push(...getSwapTicks(filteredEventsForMedian));
              usdcRange = getRange(
                calculatePrice(calculateMedianTick(ticks)).usdc,
                percentageBounds
              );
            }*/

            const { structuredEvents: structuredChunk, filteredEventsCount } =
              await processSwapEventsInChunks(
                index,
                chunk,
                //usdcRange,

                progressBar
              );
            //newRun.swaps.push(...structuredChunk);
            //newRun.totalEvents += chunk.length;
            //newRun.eventsInPriceRange += filteredEventsCount;
            /*
            if (ticks.length > 0) {
              newRun.ticksUsedForMedian = ticks.length;
              newRun.medianPrice = {
                wethPerUsdc: calculatePrice(calculateMedianTick(ticks)).weth,
                usdcPerWeth: calculatePrice(calculateMedianTick(ticks)).usdc,
              };
              newRun.priceRange = {
                lower: getRange(
                  calculatePrice(calculateMedianTick(ticks)).usdc,
                  percentageBounds
                ).lower,
                upper: getRange(
                  calculatePrice(calculateMedianTick(ticks)).usdc,
                  percentageBounds
                ).upper,
              };
            }*/

            const query = `
        INSERT INTO public.swap_events (block_number, transaction_hash, timestamp, usdc, weth, sqrt_price_x96, liquidity, tick)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

            //console.log("Structured chunk: ", structuredChunk[0]);
            /*console.log(
              "Structured chunk tx hash: ",
              structuredChunk[0].txHash
            );*/
            for (const event of structuredChunk) {
              try {
                await client.query(query, [
                  event.block_number,
                  event.transaction_hash,
                  event.timestamp,
                  event.usdc,
                  event.weth,
                  event.sqrtPriceX96,
                  event.liquidity,
                  event.tick,
                ]);
              } catch (error) {
                console.log(error);
              }
            }
            const heapUsedInBytes = process.memoryUsage().heapUsed;
            const heapUsedInMegabytes = (
              heapUsedInBytes /
              (1024 * 1024)
            ).toFixed(2);
            progressBar.increment(blocksTraversed, {
              heapUsed: heapUsedInMegabytes,
            });
          },
          progressBar
        );
      } catch (error) {
        multiBar.stop();
        console.log("\n", providers[index].name, "\nError: ", error);
      }
    });

    // Wait for all promises to complete
    await Promise.all(promises);
    multiBar.stop();

    const endTime = Date.now();
    //newRun.duration = endTime - startTime;

    //console.log(`Run ${runId} completed in ${newRun.duration} ms`);
    //console.log(`Total events processed: ${eventsProcessed}`);

    rl.close();
  } catch (error) {
    console.error("Error: ", error);
  } finally {
    rl.close();
    client.end();
    process.exit(0);
  }
}

const param = process.argv[2];
main(param);

export {
  calculatePrice,
  calculateMedianTick,
  getSwapTicks,
  getRange,
  getSwapEvents,
  main,
};
