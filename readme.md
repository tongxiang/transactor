### DonorsChoose transaction script

During the second run of Science Sleuth, the DonorsChoose donation functionality produced a lot of errors for users when the transaction was being submitted. 

This required us to manually run, in series, the transactions for all the users who received an error message. 

This script accepts a CSV of users, with the columns in-order: 1) mobile phone number 2) email 3) first name. It then runs transactions for all of these users, in series. If the transaction for any single user errors out, that user's data is inserted into a new CSV file generated at the end of the script: `usersWhoseTransactionsErrored.csv`. 

### Installation
Requires the environmental variables `DONORSCHOOSE_API_KEY`, `DONORSCHOOSE_API_PASSWORD`, and `DONORSCHOOSE_DEFAULT_EMAIL`. 

Run `npm install`. 

### Usage

Within the directory of `app.js`, run as a terminal command `node app.js <path to CSV file to run transactions on>`. 

When the script finishes running, the terminal will print "All transactions have been processed" and will generate a CSV file of the users who've errored out. 