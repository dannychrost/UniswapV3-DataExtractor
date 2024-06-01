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

### Clone the Repository

```sh
git clone https://github.com/dannychrost/UniswapV3-DataExtractor.git
cd ./UniswapV3-DataExtractor
```

### Install Dependencies

```sh
npm install
```

### Set Up Environment Variables

Create a `.env` file in the project root and update the following values:

```sh
DATABASE_URL=postgres://username:password@localhost:5432/uniswapv3usdcweth
WEBSOCKET_URLS=["wss://polygon-mainnet.infura.io/ws/v3/your-api-key"]
RATE_LIMITS=[100]
CHUNK_SIZES=[1000]
MAX_CONCURRENT=[20]
```

### Database Setup

#### Create the PostgreSQL Database and User

1. Connect to PostgreSQL:

   ```sh
   psql -U postgres
   ```

2. Create a new database:

   ```sql
   CREATE DATABASE uniswapv3usdcweth;
   ```

3. Create a new user and grant privileges:

   ```sql
   CREATE USER your_username WITH ENCRYPTED PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE uniswapv3usdcweth TO your_username;
   ```

4. Connect to the database and grant privileges on all tables:
   ```sh
   \c uniswapv3usdcweth;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_username;
   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_username;
   ```

## Usage

To start fetching and processing swap events, run:

```sh
npm start
```

You can specify the range of blocks to process as a command-line argument:

```sh
npm start -- --blocks-back=50000
```

This command will process the last 50,000 blocks.

If you need to increase the maximum heap size for Node.js, you can use one of the following commands:

```sh
npm run start-1gb
npm run start-2gb
npm run start-3gb
npm run start-4gb
npm run start-5gb
npm run start-6gb
npm run start-7gb
npm run start-8gb
npm run start-9gb
npm run start-10gb
npm run start-11gb
npm run start-12gb
```

Each command sets the `--max-old-space-size` option to a different value, in megabytes. For example, `npm run start-1gb` sets the maximum heap size to 1024 MB, `npm run start-2gb` sets it to 2048 MB, and so on.

## Future Updates

Here are some ideas for future updates that can improve the program:

1. **Resume Progress with Existing Database Entries**

   - **Description**: If a database already exists with entries, the program should be able to verify those entries and resume progress from the last processed block.
   - **Benefit**: This feature would make the program more robust and resilient, allowing it to continue processing data seamlessly after interruptions or restarts.
   - **Implementation**: Implement logic to check the highest block number already processed in the database and start fetching from the next block.

2. **Continuous Sync from Oldest to Newest Blocks**

   - **Description**: The program should fetch data starting from the oldest block and sync up to the most recent block, then continue running in real-time by fetching new blocks as they are produced.
   - **Benefit**: This would ensure that the database has a complete record of swap events from the entire history of the blockchain, and it stays up-to-date with new events.
   - **Implementation**: Implement a loop that fetches historical data and, once caught up, switches to real-time data fetching using WebSocket or polling mechanisms.

3. **Turn Program into REST Endpoints**
   - **Description**: Transform the program into a set of REST endpoints that can be queried to fetch data, start/stop data fetching, and check the status of the sync process.
   - **Benefit**: Exposing the program as a REST API would make it more versatile and easier to integrate with other applications and services.
   - **Implementation**: Use a web framework like Express.js to create RESTful endpoints that interact with the data fetching logic and the PostgreSQL database.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or create issues for bugs, questions, and feature requests.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.
