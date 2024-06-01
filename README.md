# NYC Node Uniswap V3 Data Extractor

The NYC Node Uniswap V3 Data Extractor is a robust Node.js application designed to interact with the Uniswap V3 protocol on the Polygon network. This tool captures swap events data and processes it into a PostgreSQL database for further analysis. Created by Daniel Chrostowski, this project aims to facilitate deep analytics of market dynamics on Uniswap V3.

## Features

- Fetch swap events from the Uniswap V3 contracts on Polygon.
- Process and store relevant data points such as block number, transaction hash, timestamp, WETH and USDC amounts, sqrt price, liquidity, and tick in PostgreSQL.
- Use of WebSocket connections for live data fetching.
- Rate limiting to manage API usage.
- Dynamic progress tracking with CLI progress bars.
- Resilient error handling and data integrity checks.

## Prerequisites

Before you start, ensure you have the following installed:

- Node.js (v20.14.0 or newer)
- npm or yarn
- PostgreSQL (v16 or newer)
- A proper setup of the Node environment with access to Ethereum nodes (via WebSocket URLs)

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-repo/nyc-node-uniswapv3.git
   cd nyc-node-uniswapv3
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up the environment variables:**

   Create a `.env` file in the project root and update the following values:

   ```plaintext
   DATABASE_URL=postgres://username:password@localhost:5432/uniswapv3usdcweth
   WEBSOCKET_URLS=["wss://polygon-mainnet.infura.io/ws/v3/your-api-tey"]
   RATE_LIMITS=[100]
   CHUNK_SIZES=[1000]
   MAX_CONCURRENT=[20]
   ```

## Database Setup

Run the following command to set up the PostgreSQL database schema:

```bash
npm run setup-db
```

This script will connect to your PostgreSQL database and create the necessary tables and indices for storing the swap events.

## Usage

To start fetching and processing swap events, run:

```bash
npm start
```

You can specify the range of blocks to process as a command-line argument:

```bash
npm start -- --blocks-back=50000
```

This command will process the last 50,000 blocks.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or create issues for bugs, questions, and feature requests.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
