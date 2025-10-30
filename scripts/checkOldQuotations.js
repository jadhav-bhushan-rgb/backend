const mongoose = require('mongoose');
require('dotenv').config();

const Quotation = require('../models/Quotation');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://damsole:Damsole@cluster0.mwqeffk.mongodb.net/komacut?retryWrites=true&w=majority';

async function checkOldQuotations() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const quotations = await Quotation.find().sort({ createdAt: -1 });
    
    console.log(`\n📊 Total Quotations: ${quotations.length}\n`);
    
    quotations.forEach((quot, index) => {
      console.log(`${index + 1}. Quotation: ${quot.quotationNumber}`);
      console.log(`   ID: ${quot._id}`);
      console.log(`   Inquiry ID: ${quot.inquiryId}`);
      console.log(`   Status: ${quot.status}`);
      console.log(`   Created: ${quot.createdAt}`);
      console.log(`   PDF Field: ${quot.quotationPdf || 'NULL/EMPTY ❌'}`);
      console.log(`   Has PDF: ${quot.quotationPdf ? '✅' : '❌'}`);
      console.log('');
    });

    // Count quotations with and without PDF
    const withPdf = quotations.filter(q => q.quotationPdf).length;
    const withoutPdf = quotations.filter(q => !q.quotationPdf).length;
    
    console.log(`\n📈 Summary:`);
    console.log(`   With PDF: ${withPdf} ✅`);
    console.log(`   Without PDF: ${withoutPdf} ❌`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkOldQuotations();

