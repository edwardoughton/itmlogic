
// **********************************************************

'use strict';

// **********************************************************


var mathjs = require('mathjs');
var gwave_field = require('./data/gwave_field.json');   // [Genoa vendor] only modification — relative path adjusted for vendor layout (was ../data/gwave_field.json)
var gwconst = function( sigma, epsilon, freq_mhz, radius_factor, dist) {

	//*************************************************************

	  // GWCONST - Set groundwave constants.  The independent variables
	  // passed as arguments of this subroutine are:

		  // SIGMA, the ground conductivity in millisiemens/meter
		  // EPSILON, the relative dielectric constant (1.0 for air)
		  // freq_mhz, the frequency in MHz
		  // RADIUS_FACTOR, the effective earth radius factor
		  // DIST, radio path length in kilometers

	  // Quantities calculated in this subroutine and returned are:

		  // P, amplitude of the complex numerical distance introduced
		  // for the solution of radio propagation problems by Arnold
		  // Sommerfeld in 1909

		  // B, phase angle of the numerical distance

		  // K, a dimensionless parameter proportional to the cube-
		  // root of the ratio of wavelength to the effective earth
		  // radius, and dependent also upon the ground constants

		  // CHI, a dimensionless parameter proportional to the cube-
		  // root of the effective earth radius measured in wavelengths,
		  // and proportional also to the radio path distance measured
		  // as the angle subtended from the center of the earth.

	  // Use of the symbols P and B for the amplitude and phase of
	  // the numerical distance follows Norton, Proc. IRE 1941.

	  // The symbol K is used to denote exactly the same quantity in
	  // NBS Tech Note 101, in Norton's 1941 IRE paper and in the
	  // 1949 book by Bremmer.  See references below.

	  // CHI is used in evaluating the residue series.  The Greek letter
	  // of that name was used for this quantity by Bremmer in his 1949
	  // book.  Wait, in 1956 and 1964 publications identified below,
	  // uses the capital letter X to represent this same quantity.

	  // References:

		  // K. A. Norton, "The Calculation of Ground-Wave Field
		  // Intensity over a Finitely Conducting Spherical Earth",
		  // Proc. IRE, Dec 1941, pages 623-639.

		  // H. Bremmer, Terrestrial Radio Waves, Elsevier
		  // Publishing Co., 1949.

		  // J. R. Wait, "Radiation from a Vertical Antenna Over a
		  // Curved Stratified Ground", Journal of Research of the
		  // National Bureau of Standards, Vol. 56, No. 4, April 1956

		  // J. R. Wait, "Electromagnetic Surface Waves", chapter
		  // contributed to Advances in Radio Research, J. A. Saxton,
		  // Ed., Academic Press, N.Y., 1964, pages 157-217.
	  
	// *************************************************************/



	var EARTH_RADIUS = 6370; // km

	//  Speed of light in vacuum
	var SPEED = 299792.5;    // km/second

	// Refractivity at earth surface
	var REFRACTIVITY = 0.000315; 

	var SPEED_IN_AIR = 0.0;
	var WAVELENGTH = 0.0;
	var EFFECTIVE_RADIUS = 0.0;
	var X = 0.0;
	var B1 = 0.0;
	var B2 = 0.0;
	var P = 0.0;
	var B = 0.0;
	var K = 0.0;
	var CHI = 0.0;

	//  Determine effective earth radius from  given earth radius factor.
	var EFFECTIVE_RADIUS = radius_factor * EARTH_RADIUS;

	//  Find wavelength.  Distance and the effective earth radius will
	//  be divided by wavelength to produce dimensionless quantities.

	SPEED_IN_AIR = SPEED / ( 1 + REFRACTIVITY );	     // km/second
	WAVELENGTH = SPEED_IN_AIR / ( 1000000 * freq_mhz ); 
	
	//  ground constants by formulas that appear in Norton, Proc. IRE, 1941.

	X  = 2 * Math.pow(( SPEED_IN_AIR * 0.00001 ), 2) * sigma / freq_mhz;
	B1 = Math.atan2( (epsilon - 1), X );
	B2 = Math.atan2( epsilon, X );

	//  Calculation of numerical distance, P, and its phase angle, B

	P = Math.PI * ( dist / WAVELENGTH ) * Math.pow(Math.cos( B2 ), 2) / ( X * Math.cos( B1 ));
	B = 2 * B2 - B1;

	//  Calculation of K.  See Norton, Proc. IRE, Dec 1941, page 628.
	K = Math.pow( (WAVELENGTH / ( 2 * Math.PI * EFFECTIVE_RADIUS )), ( 1.0/3 )) * Math.sqrt( X * Math.cos( B1 ) ) / Math.cos( B2 );

	// Calculation of CHI.  Confer Bremmer, Terrestrial Radio Waves,
	// page 49, equation (III, 31).  This is the quantity X defined
	// following equation (21) on page 239 of Wait, 1956.  The 
	// definition is also given following equation (90) on page 179
	// of Wait's 1964 publication.

	CHI = dist / EFFECTIVE_RADIUS * Math.pow((2 * Math.PI * EFFECTIVE_RADIUS / WAVELENGTH ), (1.0/3));

	var result = {"P": P, "B": B, "K": K, "CHI": CHI};

	return result;

}


var surface = function(P, B, K) {

//***********************************************************
//
//  SURFACE - Calculation of surface wave attenuation.  The
//  flat earth value is found by the usual formula due to A.
//  Sommerfeld.  Corrections for curved earth are then applied.
//  The curved earth corrections are from H. Bremmer, "Applications
//  of Operational Calculus to Ground-Wave Propagation,
//  Particularly for Long Waves", IRE Transactions on Antennas
//  and Propagation, July 1958.
//
//  Inputs are the numerical distance, P, its phase, B, and
//  the parameter K.  The parameter K (so denoted by Norton
//  and in NBS Tech Note 101) carries information concerning
//  the effective earth radius so that spherical earth
//  corrections can be applied.
//
//  Output is the attenuation factor, A.
//
//***********************************************************

var Z = mathjs.complex(0.0,0.0);
var DEL = mathjs.complex(0.0,0.0);
var RHO = mathjs.complex(0.0,0.0);

var ZA = mathjs.complex(0.0,0.0);
var ZADJ = mathjs.complex(0.0,0.0);
var ZADJ1 = mathjs.complex(0.0,0.0);
var ZADJ2 = mathjs.complex(0.0,0.0);
var ZADJ3 = mathjs.complex(0.0,0.0);
var Z1 = mathjs.complex(0.0,0.0);
var Z3 = mathjs.complex(0.0,0.0);

var onezero = mathjs.complex(1.0,0.0);
var zeroone = mathjs.complex(0.0,1.0);

var part, part1, part2, part3, part4, part5;
var part6, part7, part8, part9, part10;
var term, term1, term2, term3, term4, term5;

//  Begin execution.  Convert input variables P, B to complex form.
//  The resulting complex variable, RHO,  will always be in the
//  upper half-plane.  Its square root, Z, will always be in the 1st quadrant.

var RHO = mathjs.multiply(P, mathjs.add( Math.cos( B ), mathjs.multiply(zeroone, Math.sin( B )) ));
var Z = mathjs.multiply(Math.sqrt( P ), mathjs.add( Math.cos( B/2 ), mathjs.multiply(zeroone, Math.sin( B/2 )) ));

//   The complex parameter DEL is determined by K and the angle B.
	
var DEL = mathjs.multiply(K, mathjs.add( Math.cos( 3*Math.PI/4 - B/2 ), mathjs.multiply(zeroone, Math.sin( 3*Math.PI/4 - B/2 )) ));
//console.log('surface: ', P, B, K, RHO, Z, DEL)

//  Find complex attenuation for flat earth
var ZA = sommerfld(RHO);

//console.log('in surface ZA=', ZA);

/*  Adjust for spherical earth   

  Spherical earth correction formulas.  Use when numerical
  distance is not close to 0.  Notice formulas are in cascade
  so that the last automatically uses those previous.  They 
  are written this way so that they can be examined separately,
  but direct reference in the program is made only to
  the last formula.

  ZA denotes the Sommerfeld flat-earth attenuation which must
  be calculated separately.
 */

 
 part1 = mathjs.add(onezero, mathjs.multiply(2, RHO));
 part2 = mathjs.multiply(part1, ZA);
 part3 = mathjs.subtract(part2, onezero);
 
 part4 = mathjs.multiply(Math.PI, RHO);
 part5 = mathjs.sqrt(part4);
 part6 = mathjs.multiply(zeroone, part5);
 
 part7 = mathjs.subtract(part3, part6);
 
 part8 = mathjs.multiply(0.5, part7);
 
 part9 = mathjs.multiply(mathjs.pow(DEL, 3), part8);
 
 ZADJ1 = mathjs.add(ZA, part9);
 
 //console.log('ZADJ1', ZADJ1)
 //ZADJ1 = ZA + pow(DEL,3) * 1/2 * ( ( onezero + 2. * RHO ) * ZA - onezero - zeroone * sqrt( PI * RHO ) ); -- original c++ code for reference


 part1 = mathjs.subtract(mathjs.multiply(0.5, mathjs.pow(RHO,2)), onezero);
 part2 = mathjs.multiply(part1, ZA);
 
 part3 = mathjs.multiply(zeroone, mathjs.sqrt(mathjs.multiply(Math.PI, RHO)));
 part4 = mathjs.multiply(part3, mathjs.subtract(1, RHO));
 
 part5 = mathjs.add(part2, part4);
 
 part6 = mathjs.add(part5, onezero);
 part7 = mathjs.subtract(part6, mathjs.multiply(2, RHO));
 part8 = mathjs.add(part7, mathjs.multiply(5/6, mathjs.pow(RHO, 2)));
 
 part9 = mathjs.multiply(mathjs.pow(DEL, 6), part8);
 
 ZADJ2 = mathjs.add(ZADJ1, part9); 
 
//console.log('ZADJ2', ZADJ2)
 
 // original c++ code for reference
 //ZADJ2 = ZADJ1 + pow(DEL, 6) * ( ( 1./2. * pow(RHO,2) - onezero ) * ZA + zeroone * sqrt( PI * RHO ) * ( 1. - RHO ) + onezero - 2. * RHO + 5./6. * pow(RHO, 2));

 
 //( 35./8. - 1./4. * pow(RHO,2) + 1./6. * pow(RHO,3) ) * ZA -- calculated as term1
 part1 = mathjs.subtract(35/8, mathjs.multiply(1/4, mathjs.pow(RHO, 2)));
 part2 = mathjs.add(part1, mathjs.multiply(1/6, mathjs.pow(RHO, 3)));
 term1 = mathjs.multiply(part2, ZA);
 
 //zeroone * sqrt( PI * RHO ) -- calculated as term2
 term2 = mathjs.multiply(zeroone, mathjs.sqrt(mathjs.multiply(Math.PI, RHO)));
 
 
 //(35./8 - 35./8. * RHO + 31./16. * pow(RHO,2) - 5./16 * pow(RHO,3) ) -- calculated as term3
 part1 = mathjs.subtract(35/8, mathjs.multiply(35/8, RHO));
 part2 = mathjs.add(part1, mathjs.multiply(31/16, mathjs.pow(RHO, 2)));
 term3 = mathjs.subtract(part2, mathjs.multiply(5/16, mathjs.pow(RHO, 3)));
 
 //-35./8. + 35./4. * RHO - 67./12. * pow(RHO, 2) + 5./3. * pow(RHO,3) -- calculated as term4
 part1 = mathjs.add(-35/8, mathjs.multiply(35/4, RHO));
 part2 = mathjs.subtract(part1, mathjs.multiply(67/12, mathjs.pow(RHO, 2)));
 term4 = mathjs.add(part2, mathjs.multiply(5/3, mathjs.pow(RHO, 3)));
 
 term5 = mathjs.multiply(term2, term3)
 
 term = mathjs.subtract(term1, term5);
 term = mathjs.add(term, term4);
 term = mathjs.multiply(mathjs.pow(DEL, 9), term);
 
 ZADJ3 = mathjs.add(ZADJ2, term);
 
 //console.log('ZADJ3', ZADJ3);
 
//ZADJ3 = ZADJ2 + pow(DEL, 9) * ( ( 35./8. - 1./4. * pow(RHO,2) + 1./6. * pow(RHO,3) ) * ZA - zeroone * sqrt( PI * RHO ) * (35./8 - 35./8. * RHO + 31./16. * pow(RHO,2) - 5./16 * pow(RHO,3) ) - 35./8. + 35./4. * RHO - 67./12. * pow(RHO, 2) + 5./3. * pow(RHO,3) );

if ( mathjs.abs(RHO) > 0.5 ) {// sqrt function = CABS
	ZADJ = ZADJ3;
}
else {
	Z1 = mathjs.multiply(zeroone, Z);
	Z3 = mathjs.pow( mathjs.multiply(DEL, Z1), 3);
	var s1 = SERIES1(Z1);
	//console.log('series1=', s1);
	var s2 = SERIES2(Z1);
	//console.log('series2=', s2);
	var s3 = SERIES3(Z1);
	//console.log('series3=', s3);
	
	part1 = mathjs.subtract(s2, mathjs.multiply(Z3, s3));
	part2 = mathjs.subtract(s1, mathjs.multiply(Z3, part1));
	
	ZADJ = mathjs.subtract(ZA, mathjs.multiply(Z3, part2));
	
	//console.log('ZADJ', ZADJ)
	
	//ZADJ = ZA - Z3 * ( SERIES1( Z1 ) - Z3 * ( SERIES2( Z1 ) - Z3 * ( SERIES3( Z1 ) )));
}
 
var A = mathjs.abs(ZADJ);

return A;
 
}

var sommerfld = function(RHO) {

//***********************************************************
//
//  SOMMERFLD - Calculation of the surface wave attenuation
//  factor for given "numerical distance".  Numerical
//  distance is the parameter introduced by A. Sommerfeld
//  in 1909 when he showed how to integrate Maxwell's
//  equations for propagation over a finitely conducting
//  plane earth.
//
//  Input is the numerical distance in complex form, RHO.
//
//  Output ZA is the complex surface wave attenuation factor
//  for a flat earth.
//
//***********************************************************

var S = mathjs.complex(0.0,0.0);
var T = mathjs.complex(0.0,0.0);
var W = mathjs.complex(0.0,0.0);
var Z = mathjs.complex(0.0,0.0);

var ERFC = mathjs.complex(0.0,0.0);

var TERM = mathjs.complex(1.0,0.0);
var SUM = mathjs.complex(1.0,0.0);
var TEST = mathjs.complex(1E20,0.0);

var zeroone = mathjs.complex(0.0,1.0);
var onezero = mathjs.complex(1.0,0.0); 

var ZA;

//  Coefficients C1, D1 etc. to approximate w-function of
//  large modulus (M. Abramowitz and I. Stegun, Handbook of
//  Mathematical Functions, National Bureau of Standards, 1964, page 328).

var C1 = 0.4613135;
var C2 = 0.09999216;
var C3 = 0.002883894;

var D1 = 0.1901635;
var D2 = 1.7844927;
var D3 = 5.5253437;

var i;

//  Begin execution.  The numerical distance, as a complex
//  variable, should always be found in the upper half-plane.
//  Calculate its square root, Z, which will be located in the first quadrant.

if( RHO.im < 0.0) {
	console.log("ERROR: Complex numerical distance in lower half-plane (negative imaginary part of RHO). Execution stopped.");
}
else{
	Z = mathjs.sqrt( RHO );
}

//console.log('RHO', RHO, 'Z', Z);

//  Approximation formula for w-function of large modulus. 
//  Error less than 2 parts in 1E6 provided -3.9 < X < 3.9 or Y > 3. 

var part1 = mathjs.divide(C1, ( mathjs.subtract(mathjs.pow(Z, 2), D1) ));
var part2 = mathjs.divide(C2, ( mathjs.subtract(mathjs.pow(Z, 2), D2) ));
var part3 = mathjs.divide(C3, ( mathjs.subtract(mathjs.pow(Z, 2), D3) ));
var part4 = mathjs.multiply(zeroone, Z);

var part = mathjs.add(part1, part2);
var part = mathjs.add(part, part3);

W = mathjs.multiply(part4, part);

//W = zeroone * Z * ( mathjs.divide(C1, ( mathjs.subtract(mathjs.pow(Z, 2), D1) )) + mathjs.divide(C2, ( mathjs.subtract(mathjs.pow(Z, 2), D2) )) +     mathjs.divide(C3, ( mathjs.subtract(mathjs.pow(Z, 2), D3) ))                     );

//console.log("W", W);

//Z = mathjs.complex(0.8,0.5);

//  Determine most appropriate method.
if( Z.re > 3.9 || Z.im > 3.0) { // do 300
//  For arguments with large absolute magnitude, compute the
//  complex attenuation function in terms of the w-function
//  described in Abramowitz.

part = mathjs.multiply(zeroone, Math.sqrt(Math.PI));
part = mathjs.multiply(part, Z);
part = mathjs.multiply(part, W);

ZA = mathjs.add(onezero, part);

//ZA = onezero + zeroone * sqrt( PI ) * Z * W;

//console.log('ZA', ZA);

}

//  NOTE: CABS in Fortran is defined as follows:
//     "If A is type COMPLEX, the absolute value is computed as:
//     SQRT(REALPART(A)**2+IMAGPART(A)**2)"
//     We use the expanded form here and below since C++ doesn't seem to have an equivalent function 
  
else if ( (Math.sqrt( Z.re * Z.re + Z.im * Z.im)) > 1.0) {
//  When Z is outside the unit circle but below the horizontal
//  line X = 3.9 and left of Y = 3.0, calculate the complex
//  surface attenuation in terms of the complementary error
//  function.  The latter is to be evaluated at (0,1) * Z, and
//  the series of Salzer provides a close approximation.


part = mathjs.multiply(-1, zeroone);
part = mathjs.multiply(part, Z);
//ERFC = salzer( -zeroone * Z );
ERFC = salzer(part);

//console.log('ERFC', ERFC);

part = mathjs.multiply(Math.sqrt(Math.PI), zeroone);
part = mathjs.multiply(part, Z);
part = mathjs.multiply(part, mathjs.exp(mathjs.multiply(-1, RHO)));
part = mathjs.multiply(part, ERFC);
part = mathjs.add(onezero, part);
ZA = part;

//console.log('ZA', ZA);

//ZA = onezero + zeroone * sqrt( PI ) * Z * exp( -RHO ) * ERFC;

}

else { 
//  Power series for small RHO.  For ABS( RHO ) = 1 or less,
//  the I-th term will be less than 1E-35 in magnitude after 33 terms.
	for(i=1; i <= 33; i++) {
		//console.log(i)

// term replaces TERM in original - check value 
		part1 = -2 / (2*i -1);
		part = mathjs.multiply(part1, RHO);
		TERM = mathjs.multiply(part, TERM);
		//TERM = (-2.0) * RHO * TERM / ( 2.0 * i - 1.0); 
		SUM = mathjs.add(SUM, TERM);
		
		//console.log('RHO', RHO, 'TERM', TERM, 'SUM', SUM);
		if ( mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E5 )) ) {  
			break;
		}
		else {
			TEST = SUM;
		}
		
		part1 = mathjs.exp(mathjs.multiply(-1, RHO));
		part2 = mathjs.multiply(Math.sqrt(Math.PI), part1);
		part3 = mathjs.multiply(Z, part2);
		part4 = mathjs.multiply(zeroone, part3);
		ZA = mathjs.add(SUM, part4);
    	   // *ZA = SUM + zeroone * Z * sqrt( PI ) * exp( -RHO );        //120
		   
		//console.log('ZA', ZA);

	}	  
}
		  
return ZA;		  
		  
		  

}

var salzer = function(Z) {

//console.log('in salzer, Z=', Z);
var i, N;
       
var TEST = mathjs.complex(0.0, 0.0);
var SUM = mathjs.complex(0.0,0.0); 
var SALZER = mathjs.complex(0.0,0.0);
var zeroone = mathjs.complex(0.0,1.0);
 
	//COMMON / INOUT / IN, IO, IPSW

var X = 0.0;
var Y = 0.0;
var T = 0.0;
var REALERFC = 0.0;

var part, part1, part2, part3, part4;

//  Begin execution.

X = Z.re;
Y = Z.im;

if ( Y != 0.0 ) {
	N = 50;
	if( Math.abs( 80.0/Y ) > 50.0 ) {
		N = Math.abs(80/Y); // Limit to avoid overflow
	}
	
	TEST = mathjs.complex(1E20, 1E20);	// large initial value

	for(i=1; i <= N; i++) {
		part1 = Math.pow(i, 2) + 4 * Math.pow(X, 2);
		part2 = mathjs.add(F(X, Y, i), mathjs.multiply(zeroone, G(X, Y, i)))
		part3 = Math.exp(-0.25 * Math.pow(i,2));
		part4 = part3/part1;
		part = mathjs.multiply(part4, part2);
		SUM = mathjs.add(SUM, part);
		
		//SUM = SUM + exp( -0.25 * ( pow((double)i,2.) ) ) * ( F( X, Y, i ) + zeroone * G( X, Y, i ) ) / ( pow((double)i,2.) + 4.0 * pow(X,2.) );
		if ( mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E5 )) ) {  
			break;
		}
		else if (i == N && mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E5 )) ) {
			  console.log("salzer:  Unexpected error: Salzer series failed to converge.");
		}
		
		TEST = SUM;
	}
}

part1 = -2 * Math.exp(-Math.pow(X, 2)) / Math.PI;
SALZER = mathjs.multiply(part1, SUM);
//console.log('SALZER 1', SALZER);

if (X != 0) {
	part1 = Math.exp(-Math.pow(X, 2)) / (2 * Math.PI * X);
	part2 = 1 - Math.cos(2 * X * Y);
	part3 = mathjs.multiply(zeroone, Math.sin(2 * X * Y));
	part4 = mathjs.add(part2, part3);
	part = mathjs.multiply(part1, part4);
	SALZER = mathjs.subtract(SALZER, part);
}
	//console.log('part', part);
//console.log('SALZER 2', SALZER);

// SALZER = - 2 * exp( -pow(X,2)) * SUM / PI;
// if ( X != 0.0 ) SALZER = SALZER - exp( -pow(X,2) ) * ( 1 - cos( 2 * X * Y ) + zeroone * sin( 2 * X * Y ) ) / ( 2 * PI * X );

// When called to aid evaluation of the Sommerfeld complex
// surface wave attenuation, the variable Z will be in the
// 3rd quadrant.  Additional provision is made below to
// return the value of the complementary error function 
// independent of what quadrant Z is in. 

if ( X >= 0.0 ) {
	SALZER = mathjs.add(SALZER, realerfc(X));
}
else {
	SALZER = mathjs.add(SALZER, 2.0 - realerfc(-X));
}

//console.log('X', X, ' SALZER=', SALZER)

return SALZER;

}

var realerfc = function(X) {

//  Coefficients P, and A1, A2, etc. to approximate error
//  function of real argument (C. Hastings, Approximations
//  for Digital Computers, Princeton Univ. Press, 1955 )

var P   =  0.3275911;
var A1  =  0.2548296;
var A2  = -0.2844967;
var A3  =  1.4214137;
var A4  = -1.4531520;
var A5  =  1.0614054;

var T   = 0.0;
var REALERFC = 0.0;

//  Approximation of complementary error function for real, non-negative arguments
    
var	T = 1 / ( 1 + P * X );
var REALERFC = T * ( A1 + T * ( A2 + T * ( A3 + T  * ( A4 + T * ( A5 ))))) * Math.exp( -Math.pow(X, 2));

return REALERFC;
}

var F = function(X, Y, N) {
//  Functions for approximating ERF of complex arguments.
	return ( 2 * X - 2 * X * Math.cosh( N * Y ) * Math.cos( 2 * X * Y ) + N * Math.sinh( N * Y ) * Math.sin( 2 * X * Y ));
}

var G = function(X, Y, N) {  
	return ( 2 * X * Math.cosh( N * Y ) * Math.sin( 2 * X * Y ) + N * Math.sinh( N * Y ) * Math.cos( 2 * X * Y ));
}

var SERIES1 = function(Z) {
var i;

var series1 = mathjs.complex(0.0,0.0);
var ODDTERM = mathjs.complex(0.0,0.0);
var EVENTERM = mathjs.complex(0.0,0.0);
var onezero = mathjs.complex(1.0,0.0);
var SUM = mathjs.complex(0.0,0.0);
var TERM = mathjs.complex(0.0,0.0);
var TEST = mathjs.complex(0.0,0.0);

var part, part1, part2, part3, part4;

ODDTERM = mathjs.multiply(4/(Math.sqrt(Math.PI)*3), Z);
EVENTERM = onezero;
SUM = mathjs.add(1, mathjs.multiply(2, ODDTERM));

for(i = 2; i <= 50; i++) {
	if ( i%2 == 0 ) {
		part1 = mathjs.multiply(2/(i+2), mathjs.pow(Z, 2));
		EVENTERM = mathjs.multiply(part1, EVENTERM);
		TERM = EVENTERM;
	}
	else {
		part1 = mathjs.multiply(2/(i+2), mathjs.pow(Z, 2));
		ODDTERM = mathjs.multiply(part1, ODDTERM);
		TERM = ODDTERM;
	    }
	SUM = mathjs.add(SUM, mathjs.multiply(i+1, TERM));
	
	
	
	if ( i > 1 && mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E6 )) ) {
		part1 = mathjs.multiply(SUM, Math.sqrt(Math.PI));
		series1 = mathjs.divide(part1, 2);
		return series1;
	}
	
	TEST = SUM;
}

console.log("SERIES1 Error:  Should never get here!");
return 0;
}



var SERIES2 = function(Z) {
var j;

var series2 = mathjs.complex(0.0,0.0);
var ODDTERM = mathjs.complex(0.0,0.0);
var EVENTERM = mathjs.complex(0.0,0.0);
var onezero = mathjs.complex(1.0,0.0);
var SUM = mathjs.complex(0.0,0.0);
var TERM = mathjs.complex(0.0,0.0);
var TEST = mathjs.complex(0.0,0.0);

var part, part1, part2, part3, part4;

EVENTERM = 8 / (15 * Math.sqrt(Math.PI));
ODDTERM = mathjs.divide(Z, 6);

part1 = mathjs.multiply(7, EVENTERM);
part2 = mathjs.multiply(2*8, ODDTERM);
SUM = mathjs.add(part1, part2);

for(j = 2; j <= 50; j++) {
	if ( j%2 == 0 ) {
		part1 = mathjs.multiply(2/(j+5), mathjs.pow(Z, 2));
		EVENTERM = mathjs.multiply(part1, EVENTERM);
		TERM = EVENTERM;
	}
	else {
		part1 = mathjs.multiply(2/(j+5), mathjs.pow(Z, 2));
		ODDTERM = mathjs.multiply(part1, ODDTERM);
		TERM = ODDTERM;
	}
	part1 = mathjs.multiply((j+1)/(j+7), TERM);
	SUM = mathjs.add(SUM, part1);
	if(j > 1 && mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E6 )) ) {
		part1 = mathjs.multiply(SUM, Math.sqrt(Math.PI));
		series2 = mathjs.divide(part1, 8);
		
		return series2;
	}
	TEST = SUM;
}           

console.log("SERIES2 Error:  Should never get here!");

return 0;
}


var SERIES3 = function(Z) {

var k;

var series3 = mathjs.complex(0.0,0.0); 
var ODDTERM = mathjs.complex(0.0,0.0);
var EVENTERM = mathjs.complex(0.0,0.0);
var onezero = mathjs.complex(1.0,0.0);
var SUM = mathjs.complex(0.0,0.0);
var TERM = mathjs.complex(0.0,0.0);
var TEST = mathjs.complex(0.0,0.0);

var part1, part2, part3;

EVENTERM = 1/ 24;
ODDTERM = mathjs.multiply(32/(945*Math.sqrt(Math.PI)), Z);
SUM = mathjs.add(mathjs.multiply(126, EVENTERM), mathjs.multiply(2*147, ODDTERM));

for(k=2; k<=50; k++) {
	if ( k%2 == 0 ) {
		part1 = mathjs.multiply(2/(k+8), mathjs.pow(Z, 2));
		EVENTERM = mathjs.multiply(part1, EVENTERM);
		TERM = EVENTERM;
	}
	else {
		part1 = mathjs.multiply(2/(k+8), mathjs.pow(Z, 2));
		ODDTERM = mathjs.multiply(part1, ODDTERM);
		TERM = ODDTERM;
	}
	
	part1 = mathjs.multiply((k+1)*(Math.pow(k, 2) + 20*k +126), TERM);
	SUM = mathjs.add(SUM, part1);
	
	//SUM = SUM + ( k + 1. ) * ( pow(k,2) + 20 * k + 126. ) * TERM;
	if(k > 1 && mathjs.abs( mathjs.subtract(SUM, TEST )) < mathjs.abs(mathjs.divide(mathjs.abs( TEST ), 1E6 )) ) {
		series3 = mathjs.multiply(Math.sqrt(Math.PI)/48, SUM);

		return series3;
	}
	TEST = SUM;
}
 
console.log("SERIES3 Error:  Should never get here!");

return 0;

}


var residues = function( CHI, K, PSI) {
	var i; 
	var S;
	var NS = 0;
	var AIR = 0.0;
	var T = mathjs.complex(0.0,0.0); 
	var DELNEW = mathjs.complex(0.0,0.0);
	var DELL = mathjs.complex(0.0,0.0);
	var DEL1 = mathjs.complex(0.0, 0.0);
	var DELDEL = mathjs.complex(0.0,0.0);
	var TAU0 = mathjs.complex(0.0,0.0);
	var TAU1 = mathjs.complex(0.0,0.0);
	var Z = mathjs.complex(0.0,0.0);
	var Z1 = mathjs.complex(0.0,0.0);  
	var ZS = mathjs.complex(0.0,0.0);
	var Q = mathjs.complex(0.0,0.0);

	var zerozero = mathjs.complex(0.0,0.0);
	var zeroone = mathjs.complex(0.0,1.0);

	var part1, part2, part3, part4, part5, part6;

	//  MAXTERMS refers to how many terms may be included in the
	//  residue series.  The number actually included will be
	//  determined by a convergence criterion represented by the parameter PRECISION.

	var MAXTERMS = 50;
	var PRECISION = 1E-5; 

	// FINENESS determines the size of the element of integration
	//  used to locate residue points.  The variable of integration
	//  will be incremented at least MINSTEPS times.

	var FINENESS = 1E-3;
	var MINSTEPS = 5;

	// No need to recalculate residue points if no change in DEL.

	var DEL = mathjs.complex(0.0,0.0);
	var QSQR = mathjs.complex(0.0, 0.0);
	var NUMPOINTS = 0;

	//  TAU(S) denotes the points in the complex plane at which
	//  residues of the diffraction field integrand are to be
	//  evaluated.

	var TAU = [];

	/*  TAU0 and TAU1 denote reference points where residues
	C  would be evaluated in certain limiting cases.  These
	C  reference points are all in the first quadrant on the line
	C  of slope 60 degrees.  The amplitudes of the complex numbers
	C  representing reference points TAU0 and TAU1 are determined
	C  from the amplitudes of corresponding roots of the Airy
	C  function and its derivative.
	C
	C  The required roots of the Airy function and its derivative
	C  are found by FUNCTION AIRY0 and FUNCTION AIRY1 respectively.
	*/

	//  Many small functions moved below...

	//  Begin execution.  Define quantities that will be used repeatedly in the residue summing loop.


	part1 = 3*Math.PI/4 - PSI;
	part2 = mathjs.exp(mathjs.multiply(part1, zeroone));
	DELNEW = mathjs.multiply(K, part2);

	//DELNEW = K * exp( zeroone * ( 3.*PI/4. - PSI ) );

	if ( !DELNEW.equals(DEL) ) {
		DEL = DELNEW;
		part1 = mathjs.divide(1, DEL);
		QSQR = mathjs.pow(part1, 2);
		//QSQR = pow(( 1/ DEL ), 2.0);
		NUMPOINTS = 0;
		for(i=0; i <=MAXTERMS; i++) {
			TAU.push(zerozero);
		}
	}

	//  Clear the variable used to accumulate the residue sum.

	ZS = mathjs.complex(zerozero.re, zerozero.im);

	//  Begin calculation of sum of residues.  If the S-th residue
	//  point been located by a previous call to this subroutine, jump past the calculation of TAU(S).

	for(S = 1; S <= MAXTERMS; S++) {

		if ( S <= NUMPOINTS ) {
			part1 = mathjs.multiply(zeroone, TAU[S]);
			part2 = mathjs.multiply(part1, CHI);
			part3 = mathjs.exp(part2);
			part4 = mathjs.multiply(2, TAU[S]);
			part5 = mathjs.subtract(part4, QSQR);
			
			Z = mathjs.divide(part3, part5);

			//  Accumulate and loop to calculate next residue until 
			//  test indicates convergence is satisfactory.

			ZS = mathjs.add(ZS, Z);
			NS = S;
			if ( S > 1 && mathjs.abs( Z ) < PRECISION * mathjs.abs( ZS ) ) {
				break;
			}
			
			continue;
		}
		
		// Find TAU(S) from TAU0 if K is small, or from TAU1 if K is
		// large.  For intermediate values of K, accuracy requires an integration procedure.

		TAU0 = TFN( AIRY0(S) );
		TAU1 = TFN( AIRY1(S) );
		
		if ( mathjs.abs( mathjs.multiply(TAU0, Math.pow(K, 2)) ) < 0.16 ) {
			TAU[S] = TAUFN0( TAU0, DEL );             // from TAU0
		}
		else if( mathjs.abs( mathjs.multiply(TAU1, mathjs.pow(K, 2))) > 1.44 ) {
			TAU[S] = TAUFN1( TAU1, mathjs.divide(1, DEL) );		//from TAU1
		}
		else {
			T = TAU0;
			if ( mathjs.abs(DEL) >= FINENESS * MINSTEPS ) {
				Z1 = mathjs.multiply(FINENESS/mathjs.abs(DEL), DEL);
				//Z1 = FINENESS * DEL / abs( DEL );
			}
			else {
				Z1 = mathjs.divide(DEL, MINSTEPS);
			}
			
			DEL1 = mathjs.complex(0, 0);
			
			//  Integrate along a diagonal path in the complex DEL-plane.
			//  The variable of integration, DEL1, runs from 0 to DEL.
				
			while ( mathjs.abs(DEL1) - mathjs.abs(DEL) < 0 ) {
				part1 = mathjs.multiply(2, T);
				part2 = mathjs.multiply(part1, mathjs.pow(DEL1, 2));
				part3 = mathjs.subtract(part2, 1);
				part4 = mathjs.abs(part3);
				part5 = Math.min(1, part4);
				
				DELDEL = mathjs.multiply(Z1, part5);
			
				//DELDEL = Z1 * min( 1., abs( 2. * T * pow(DEL1,2.) - 1. ) );
				T = TAUSTEP( T, DEL1, DELDEL );
				
				DEL1 = mathjs.add(DEL1, DELDEL);
			}
			
			TAU[S] = TAUSTEP( T, DEL1, mathjs.subtract(DEL, DEL1) );
		}

		//  Remember how many residue points have been located.  This
		//  permits reuse of this subroutine without recalculation of
		//  TAU(S) so long as the value of DEL remains unchanged, that
		//  is for changes in distance only.

		NUMPOINTS = S - 1;
		
		part1 = mathjs.multiply(zeroone, TAU[S]);
		part2 = mathjs.multiply(part1, CHI);
		part3 = mathjs.exp(part2);
		part4 = mathjs.multiply(2, TAU[S]);
		part5 = mathjs.subtract(part4, QSQR);
		
		Z = mathjs.divide(part3, part5);
		
		//  Accumulate and loop to calculate next residue until 
		//  test indicates convergence is satisfactory.

		ZS = mathjs.add(ZS, Z);
		NS = S;
		if ( S > 1 && mathjs.abs( Z ) < PRECISION * mathjs.abs( ZS ) ) {
			break;
		}
	}

	var A = mathjs.abs(ZS) * Math.sqrt( 2 * Math.PI * CHI );

	return A;
}



var AIRY0 = function(S) {
//  Roots of the Airy function

	var A0 = [2.3381074,  4.0879494, 5.5205598,  6.7867081, 7.9441336,  9.0226508, 10.0401743, 11.0085243, 11.9360156, 12.8287767];
	var airy0 = 0.0;
	var X;
	var F = 0.0;

	if (S <= 10) {
		airy0 = A0[ S-1 ];  // array runs 0 to 9 corresponding to S 1 to 10
	}
	else {
		//  Formulas used to calculate the amplitudes A0( S ) for indices greater than 10.
		X = 3 * Math.PI * ( 4 * S - 1 ) / 8;
		F = Math.pow(X,(2/3)) * ( 1 + 5/48 * Math.pow((1/X), 2));
		airy0 = F;
	}

	return airy0;

}



var AIRY1 = function(S) {
//  Roots of the derivative of the Airy function
	var A1 = [ 1.0187930,  3.2481976, 4.8200992,  6.1633074, 7.3721773,  8.4884867, 9.5354491, 10.5276604,  11.4750566, 12.3847884];
	var airy1 = 0.0;
	var Y;
	var G = 0.0;

	if ( S <= 10 ) {
		airy1 = A1[ S-1 ];  // array runs 0 to 9 corresponding to S 1 to 10
	}
	else {
		//  Formulas used to calculate the amplitudes A1( S ) for indices greater than 10.
		Y = 3 * Math.PI * ( 4 * S - 3 ) / 8;
		G = Math.pow(Y, (2/3)) * ( 1 - 7/48 * (1/Math.pow(Y,2)));
		airy1 = G;
	}

	return airy1; 

}	

var TFN = function(AIR) {

var part1 = AIR/Math.pow(2, 1/3);
var part2 = mathjs.multiply(Math.PI/3, mathjs.complex(0,1));
var ret = mathjs.multiply(part1, mathjs.exp(part2));

return ret;

//return ( AIR / pow(2.,( 1./3.)) * exp( zeroone * PI/3. ));  --original c++ code
}

var C3 = function(TA) {
	var ret = mathjs.multiply(-2/3, TA);
	return ret; 
}

var C5 = function(TA) {
	var ret = mathjs.multiply(-4/5, mathjs.pow(TA, 2));
	
	return ret;
}

var C6 = function(TA) {
	var ret = mathjs.multiply(14/9, TA);

	return ret;
}

var C7 = function(TA) { 
	var part1 = mathjs.multiply(-8/7, mathjs.pow(TA, 3));
	var ret = mathjs.add(-5, part1);

	return ret;
	//return ( (-( 5. + 8. * pow(TA, 3.)/ 7.))); --original c++ code
}

var C8 = function(TA) {
	var ret = mathjs.multiply(58/15, mathjs.pow(TA, 2));

	return ret;
}

var C9 = function(TA) { 
	var part1 = mathjs.multiply(16/9, mathjs.pow(TA, 3));
	var part2 = mathjs.add(2296/567, part1);
	var part3 = mathjs.multiply(-1, TA);
	var ret = mathjs.multiply(part3, part2);

	return ret;

	//return ( (-TA * ( 2296./567 + 16./9. * pow(TA,3.))) ); --original C++ code

}

var C10 = function(TA) {
	var part1 = mathjs.multiply(4656/525, mathjs.pow(TA, 3));
	var ret = mathjs.add(47/35, part1);

	return ret;
	 
	//return ( (47./35. + 4656./525. * pow(TA,3.)));  --original C++ code
}

var TAUFN0 = function(TA, DELL ) {
	var part1 = mathjs.multiply(DELL, C10(TA));
	var part2 = mathjs.add(C9(TA), part1);
	var part3 = mathjs.multiply(DELL, part2);
	var part4 = mathjs.add(C8(TA), part3);
	var part5 = mathjs.multiply(DELL, part4);
	var part6 = mathjs.add(C7(TA), part5);
	var part7 = mathjs.multiply(DELL, part6);
	var part8 = mathjs.add(C6(TA), part7);
	var part9 = mathjs.multiply(DELL, part8);
	var part10 = mathjs.add(C5(TA), part9);
	var part11 = mathjs.multiply(DELL, part10);
	var part12 = mathjs.add(1/2, part11);
	var part13 = mathjs.multiply(DELL, part12);
	var part14 = mathjs.add(C3(TA), part13);
	var part15 = mathjs.multiply(DELL, part14);
	var part16 = mathjs.add(0, part15);
	var part17 = mathjs.multiply(DELL, part16);
	var part18 = mathjs.add(-1, part17);
	var part19 = mathjs.multiply(DELL, part18);

	var ret = mathjs.add(TA, part19);

	return ret;

	//return ( TA + DELL *  ( -1. + DELL * ( 0. + DELL * ( C3(TA) + DELL * ( 1./2. + DELL * ( C5(TA) + DELL * ( C6(TA) + DELL * ( C7(TA) + DELL * ( C8(TA) + DELL * ( C9(TA) + DELL * ( C10(TA) )))))))))) ); --original C++ code
}

var D1 = function(TA) {
	var part1 = mathjs.multiply(2, TA);
	var ret = mathjs.divide(-1, part1);

	return ret;
	//return ( -1. / ( 2. * TA ));
}

var D2 = function(TA) {
	var part1 = mathjs.multiply(8, mathjs.pow(TA, 3));
	var ret = mathjs.divide(-1, part1);

	return ret;
	//return ( -1. / ( 8. * pow(TA,3.0)));
}

var D3 = function(TA) { 
	var part1 = mathjs.multiply(16, mathjs.pow(TA, 3));
	var part2 = mathjs.divide(1, part1);
	var part3 = mathjs.add(1/12, part2);
	var part4 = mathjs.multiply(-1, part3);

	var ret = mathjs.divide(part4, mathjs.pow(TA, 2));

	return ret;

	//return ( -1. / pow(TA,2.0) * ( 1./12.     +   1. / ( 16.  * pow(TA,3.0))) ); 
}

var D4 = function(TA) {
	var part1 = mathjs.multiply(128, mathjs.pow(TA, 3));
	var part2 = mathjs.divide(5, part1);
	var part3 = mathjs.add(7/96, part2);
	var part4 = mathjs.multiply(-1, part3);

	var ret = mathjs.divide(part4, mathjs.pow(TA, 4));

	return ret;

	//return ( -1. / pow(TA,4.0) * ( 7./96.     +   5. / ( 128. * pow(TA,3.0))) ); 
}

var D5 = function(TA) {
	var part1 = mathjs.divide(7/256, mathjs.pow(TA, 3));
	var part2 = mathjs.add(21/320, part1);
	var part3 = mathjs.divide(part2, mathjs.pow(TA, 3));
	var part4 = mathjs.add(1/40, part3);
	var part5 = mathjs.multiply(-1, part4);
	var ret = mathjs.divide(part5, mathjs.pow(TA, 3));

	return ret;

	//return ( -1. / pow(TA,3.0) * ( 1./40.     +   1. /   pow(TA,3.0) * (  21./320.  +  7.  / ( 256.  * pow(TA,3.0)) )) );  
 }

var D6 = function(TA) {
	var part1 = mathjs.divide(21/1024, mathjs.pow(TA, 3));
	var part2 = mathjs.add(77/1280, part1);
	var part3 = mathjs.divide(part2, mathjs.pow(TA, 3));
	var part4 = mathjs.add(29/720, part3);
	var part5 = mathjs.multiply(-1, part4);
	var ret = mathjs.divide(part5, mathjs.pow(TA, 5));

	return ret;

	//return ( -1. / pow(TA,5.0) * ( 29./ 720.  +   1. /   pow(TA,3.0) * (  77./1280. +  21. / ( 1024. * pow(TA,3.0)) )) ) ;
}

var D7 = function(TA) {
	var part1 = mathjs.divide(33/2048, mathjs.pow(TA, 3));
	var part2 = mathjs.add(143/2560, part1);
	var part3 = mathjs.divide(part2, mathjs.pow(TA, 3));
	var part4 = mathjs.add(19/360, part3);
	var part5 = mathjs.divide(part4, mathjs.pow(TA, 3));
	var part6 = mathjs.add(1/112, part5);
	var part7 = mathjs.multiply(-1, part6);
	var ret = mathjs.divide(part7, mathjs.pow(TA, 4));
	
	return ret;
	
	//return ( -1. / pow(TA,4.0) * ( 1./ 112.   +   1. /   pow(TA,3.0) * (  19./ 360. +   1. / pow(TA, 3.0) * ( 143./2560. +  33. / ( 2048.  * pow(TA,3.0)) ))) ); 
}

var D8 = function(TA) { 
	var part1 = mathjs.divide(429/32768, mathjs.pow(TA, 3));
	var part2 = mathjs.add(429/8192, part1);
	var part3 = mathjs.divide(part2, mathjs.pow(TA, 3));
	var part4 = mathjs.add(163/2560, part3);
	var part5 = mathjs.divide(part4, mathjs.pow(TA, 3));
	var part6 = mathjs.add(97/4480, part5);
	var part7 = mathjs.multiply(-1, part6);
	var ret = mathjs.divide(part7, mathjs.pow(TA, 6));
	
	return ret;

	//return ( -1. / pow(TA,6.0) * (  97./4480. +   1. /   pow(TA,3.0) * ( 163./2560. +   1. / pow(TA, 3.0) * ( 429./8192. + 429. / ( 32768. * pow(TA,3.0)) ))) ); 
}


var TAUFN1 = function(TA, Q) {
	var part1 = mathjs.multiply(Q, D8(TA));
	var part2 = mathjs.add(D7(TA), part1);
	var part3 = mathjs.multiply(Q, part2);
	var part4 = mathjs.add(D6(TA), part3);
	var part5 = mathjs.multiply(Q, part4);
	var part6 = mathjs.add(D5(TA), part5);
	var part7 = mathjs.multiply(Q, part6);
	var part8 = mathjs.add(D4(TA), part7);
	var part9 = mathjs.multiply(Q, part8);
	var part10 = mathjs.add(D3(TA), part9);
	var part11 = mathjs.multiply(Q, part10);
	var part12 = mathjs.add(D2(TA), part11);
	var part13 = mathjs.multiply(Q, part12);
	var part14 = mathjs.add(D1(TA), part13);
	var part15 = mathjs.multiply(Q, part14);

	var ret = mathjs.add(TA, part15);

	return ret;

	// return ( TA + Q * ( D1(TA) + Q * ( D2(TA) + Q * ( D3(TA) + Q * ( D4(TA) + Q * ( D5(TA) + Q * ( D6(TA) + Q * ( D7(TA) + Q * ( D8(TA) )))))))) ); 
}

var TAUSTEP = function(TA, DELL, DELDE ) { 
	var p1, p2, p3, p4, p5, p6;
	var part1, part2, part3, part4, part5;

	p1 = mathjs.multiply(DELL, mathjs.pow(TA, 2));
	p2 = mathjs.multiply(4, p1);
	p3 = mathjs.add(1, p2);
	part1 = mathjs.multiply(DELL, p3);

	p1 = mathjs.multiply(2, TA);
	p2 = mathjs.multiply(p1, mathjs.pow(DELL, 2));
	p3 = mathjs.subtract(p2, 1);
	part2 = mathjs.pow(p3, 3);

	part3 = mathjs.pow(DELDE, 2);

	p1 = mathjs.multiply(2, TA);
	p2 = mathjs.multiply(p1, mathjs.pow(DELL, 2));
	part4 = mathjs.subtract(p2, 1);

	part5 = mathjs.divide(DELDE, part4)

	var term1 = mathjs.add(TA, part5);

	var term2 = mathjs.divide(part3, part2);
	term2 = mathjs.multiply(term2, part1);

	var ret = mathjs.add(term1, term2);
	
	return ret;

	//return ( TA + DELDE / ( 2. * TA * pow(DELL,2.0) - 1. ) + pow(DELDE, 2.0) / pow(( 2. * TA * pow(DELL, 2.0) - 1. ), 3.0) * DELL * ( 2. * TA - DELL * ( 1. + 4. * DELL * pow(TA, 2.0)) )); 
}                                    
                                   

var amField = function(conductivity, dielectric, freq_mhz, distance, fs1km) {

	var startTime = new Date().getTime();
	var dist;
	var i, j, index_distance, index_distance_1, index_distance_2, index_cond, index_cond_1, index_cond_2;
	var distance_arr = gwave_field.distance;
	var num_distance = distance_arr.length;
	var freq_khz_str = Math.floor(freq_mhz * 100 + 0.5) * 10 + '';
	freq_khz_str = freq_mhz
	var field_arr = gwave_field[freq_khz_str];
	var conductivity_arr = [];
	for (var key in field_arr) {
		conductivity_arr.push(parseFloat(key));
	}
	conductivity_arr = conductivity_arr.sort(function(a, b){return a-b;});

	for (i = 0; i < num_distance; i++) {
		if (distance == distance_arr[i]) {
			index_distance = i;
		}
	}
		
	if (index_distance === undefined) {
		if (distance <= distance_arr[0]) {
			index_distance = 0;
		}
		else if (distance >= distance_arr[num_distance-1]) {
			index_distance = num_distance - 1;
		}
		else {
			for (i = 0; i < num_distance - 1; i++) {
				if (distance >= distance_arr[i] && distance <= distance_arr[i+1]) {
					index_distance_1 = i;
					index_distance_2 = i + 1;
				}
			}
		}
	}
	
	var num_conductivity = conductivity_arr.length;
	for (i = 0; i < num_conductivity; i++) {
		if (conductivity == conductivity_arr[i]) {
			index_cond = i;
		}
	}
	
	if (index_cond === undefined) {
	
		if (conductivity <= conductivity_arr[0]) {
			index_cond = 0;
		}
		else if (conductivity >= conductivity_arr[num_conductivity-1]) {
			index_cond = num_field-1;
		}
		else {
			for (i = 0; i < num_conductivity - 1; i++) {
				if ( conductivity >= conductivity_arr[i] && conductivity <= conductivity_arr[i+1]) {
					index_cond_1 = i;
					index_cond_2 = i + 1;
				}
			}
		}
	
	}
	
	if (index_cond !== undefined) {
		if (index_distance !== undefined) {
			var fs = gwave_field[freq_khz_str+''][conductivity_arr[index_cond]][index_distance];
		}
		else {
			var fs1 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond]][index_distance_1];
			var fs2 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond]][index_distance_2];
			var fs = fs1 + (fs2 - fs1)*(distance - distance_arr[index_distance_1])/(distance_arr[index_distance_2] - distance_arr[index_distance_1]);
		}
	}
	else {
		if (index_distance !== undefined) {
			var fs1 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_1]][index_distance];
			var fs2 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_2]][index_distance];
			var fs = fs1 + (fs2 - fs1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
			}
		else {
			var fs1 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_1]][index_distance_1];
			var fs2 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_2]][index_distance_1];
			var fs_d1 = fs1 + (fs2 - fs1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
			var fs1 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_1]][index_distance_2];
			var fs2 = gwave_field[freq_khz_str+''][conductivity_arr[index_cond_2]][index_distance_2];
			var fs_d2 = fs1 + (fs2 - fs1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
			var fs = fs_d1 + (fs_d2 - fs_d1)*(distance - distance_arr[index_distance_1])/(distance_arr[index_distance_2] - distance_arr[index_distance_1]);
		}
	}
	
	if (fs !== undefined) {
		//scale by power and rounding
		fs = fs * fs1km / 100.0;
		fs = Math.floor(fs*10000 + 0.5)/10000;
	}

	var endTime = new Date().getTime();
	var dt = endTime - startTime;
	
	return fs;
}


var amFieldFromFormula = function(sigma, epsilon, freq_mhz, distance, fs1km) {

	var startTime = new Date().getTime();
	var i_method, A;

	var radius_factor = 1.333333;  // 4/3 four-thirds earth
	var dist_critical = 80 * Math.pow(radius_factor, 0.6667) / Math.pow( freq_mhz, 0.3333);

	var gwcon = gwconst(sigma, epsilon, freq_mhz, radius_factor, distance);
	//console.log(gwcon)

	i_method = 1;
	if (distance > dist_critical) {
		i_method = 2;
	}

	//console.log('i_method=', i_method);

	if (i_method === 1) {
		A = surface(gwcon.P, gwcon.B, gwcon.K);
	}
	else {
		var PSI = 0.5 * gwcon.B;
		A = residues(gwcon.CHI, gwcon.K, PSI)
	}

	var mvm = fs1km * A / distance;

	var endTime = new Date().getTime();
	var dt = endTime - startTime;

	console.log("field: " + mvm + " time: " + dt);

	return mvm;

}


var amDistance = function(conductivity, dielectric, freq, field, fs1km) {
	// fs1km = inverse distance field strength of 100 mV/m at 1km
	//console.log('in amDistance');
	var startTime = new Date().getTime();
	var dist, f, f1, f2;
	var dist1 = 1;
	var dist2;
	var distance;
	var f1 = amField(conductivity, dielectric, freq, dist1, fs1km);
	for (dist = 10; dist < 10000; dist += 100) {
		f = amField(conductivity, dielectric, freq, dist, fs1km);
		if (f == field) {
			f1 = f;
			f2 = f;
			dist1 = dist;
			dist2 = dist;
		}
		else if (f > field) {
			f1 = f;
			dist1 = dist;
		}
		else {
			f2 = f;
			dist2 = dist;
			break;
		}
	}
	
	if (dist1 == dist2) {
		distance = dist1;
	}
	else {
		
		var num_iter = 0;
		while ( Math.max(Math.abs(f1 - field), Math.abs(f2 - field))/field > 0.01 && Math.abs(dist2 - dist1) > 0.001) {
			dist = (dist1 + dist2) / 2;
			f = amField(conductivity, dielectric, freq, dist, fs1km);
			//console.log('num_iter', num_iter, 'dist', dist, 'dist1', dist1, 'dist2', dist2, 'field', field, 'f1', f1, 'f2', f2, 'f', f);
			
			if (f <= field) {
				dist2 = dist;
				f2 = f;
			}
			else {
				dist1 = dist;
				f1 = f;
			}
			
			num_iter++;
			
		}
		
		distance = (dist1 + dist2) / 2;
	
	
	}
	
	
	
	
	var ret = {"f1": f1, "dist1": dist1, "f2": f2, "dist2":dist2, "num_iter": num_iter, "distance": distance};
	
	var endTime = new Date().getTime();
	
	var dt = endTime - startTime;
	
	//console.log("distance: " + distance + " time; " + dt);
	
	return distance;

}

var amDistance1 = function(conductivity, dielectric, freq, field, fs1km) {

	var startTime = new Date().getTime();
	var dist;
	var i, j, index_field, index_field_1, index_field_2, index_cond, index_cond_1, index_cond_2;
	var field_arr = gwave_distance.field;
	var num_field = field_arr.length;
	var freq_khz_str = freq * 1000 + '';
	var distance_arr = gwave_distance[freq_khz_str];
	var conductivity_arr = [];
	for (var key in distance_arr) {
		conductivity_arr.push(parseFloat(key));
	}
	conductivity_arr = conductivity_arr.sort(function(a, b){return a-b;});

	for (i = 0; i < num_field; i++) {
		if (field == field_arr[i]) {
			index_field = i;
		}
	}
	
	if (index_field === undefined) {
		if (field <= field_arr[0]) {
			index_field = 0;
		}
		else if (field >= field_arr[num_field-1]) {
			index_field = num_field-1;
		}
		else {
			for (i = 0; i < num_field - 1; i++) {
				if (field >= field_arr[i] && field <= field_arr[i+1]) {
					index_field_1 = i;
					index_field_2 = i + 1;
				}
			}
		}
	}
	
	var num_conductivity = conductivity_arr.length;
	for (i = 0; i < num_conductivity; i++) {
		if (conductivity == conductivity_arr[i]) {
			index_cond = i;
		}
	}
	
	if (index_cond === undefined) {
	
		if (conductivity <= conductivity_arr[0]) {
			index_cond = 0;
		}
		else if (conductivity >= conductivity_arr[num_conductivity-1]) {
			index_cond = num_field-1;
		}
		else {
			for (i = 0; i < num_conductivity - 1; i++) {
				if ( conductivity >= conductivity_arr[i] && conductivity <= conductivity_arr[i+1]) {
					index_cond_1 = i;
					index_cond_2 = i + 1;
				}
			}
		}
	
	}
	
	if (index_cond !== undefined) {
		if (index_field !== undefined) {
			var dist = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond]][index_field];
		}
		else {
			var dist1 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond]][index_field_1];
			var dist2 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond]][index_field_2];
			var dist = dist1 + (dist2 - dist1)*(field - field_arr[index_field_1])/(field_arr[index_field_2] - field_arr[index_field_1]);
		}
	}
	else {
		if (index_field !== undefined) {
			var dist1 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_1]][index_field];
			var dist2 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_2]][index_field];
			var dist = dist1 + (dist2 - dist1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
		}
		else {
			var dist1 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_1]][index_field_1];
			var dist2 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_2]][index_field_1];
			var dist_f1 = dist1 + (dist2 - dist1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
			var dist1 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_1]][index_field_2];
			var dist2 = gwave_distance[freq_khz_str+''][conductivity_arr[index_cond_2]][index_field_2];
			var dist_f2 = dist1 + (dist2 - dist1)*(conductivity - parseFloat(conductivity_arr[index_cond_1]))/(parseFloat(conductivity_arr[index_cond_2]) - parseFloat(conductivity_arr[index_cond_1]));
			var dist = dist_f1 + (dist_f2 - dist_f1)*(field - field_arr[index_field_1])/(field_arr[index_field_2] - field_arr[index_field_1]);
		}
	}
	
	if (dist !== undefined) {
		dist = Math.floor(dist*100 + 0.5)/100;
	}

	var endTime = new Date().getTime();
	var dt = endTime - startTime;
	
	console.log("distance: " + dist + " time: " + dt);
	return dist;
}



var getAmField = function(req, res) {
	console.log('============= getAmField API ===========\n');
	var conductivity = req.query.conductivity;
	var dielectric = req.query.dielectric;
	var freq = req.query.freq;
	var distance = req.query.distance;
	var fs1km = req.query.fs1km;
	
	if (conductivity === undefined) {
		console.log('conductivity missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'conductivity missing'
		});
		return;
	}
	
	if (dielectric === undefined) {
		console.log('dielectric missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'dielectric missing'
		});
		return;
	}
	
	if (freq === undefined) {
		console.log('freq missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'freq missing'
		});
		return;
	}
	
	if (distance === undefined) {
		console.log('distance missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'distance missing'
		});
		return;
	}
	
	if (fs1km === undefined) {
		console.log('fs1km missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'fs1km missing'
		});
		return;
	}
	
	if (!isValidNumber(conductivity)) {
		console.log('invalid conductivity value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid conductivity value'
		});
		return;
	}
	
	if (!isValidNumber(dielectric)) {
		console.log('invalid dielectric value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid dielectric value'
		});
		return;
	}
	
	if (!isValidNumber(freq)) {
		console.log('invalid freq value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid freq value'
		});
		return;
	}
	
	if (!isValidNumber(distance)) {
		console.log('invalid distance value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid distance value'
		});
		return;
	}
	
	if (!isValidNumber(fs1km)) {
		console.log('invalid fs1km value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid fs1km value'
		});
		return;
	}
	
	conductivity = parseFloat(conductivity);
	dielectric = parseFloat(dielectric);
	freq = parseFloat(freq);
	distance = parseFloat(distance);
	fs1km = parseFloat(fs1km);
	

	var field = amField(conductivity, dielectric, freq, distance, fs1km);
	
	var response = {
		"input": {
			"conductivity": conductivity,
			"dielectric": dielectric,
			"freq": freq,
			"distance": distance,
			"fs1km": fs1km,
			"conductivity_unit": "milliSiemens/meter",
			"freq_unit": "MHz",
			"distance_unit": "km",
			"fs1km_unit": "milivolt/meter"
		},
		"field": field,
		"unit": "milivolt/meter"
	};
	
	res.status(200).send(response);

}

var getAmDistance = function(req, res) {
	console.log('============= getAmDistance API ===========\n');
	var conductivity = req.query.conductivity;
	var dielectric = req.query.dielectric;
	var freq = req.query.freq;
	var field = req.query.field;
	var fs1km = req.query.fs1km;
	
	if (conductivity === undefined) {
		console.log('conductivity missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'conductivity missing'
		});
		return;
	}
	
	if (dielectric === undefined) {
		console.log('dielectric missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'dielectric missing'
		});
		return;
	}
	
	if (freq === undefined) {
		console.log('freq missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'freq missing'
		});
		return;
	}
	
	if (field === undefined) {
		console.log('field missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'field missing'
		});
		return;
	}
	
	if (fs1km === undefined) {
		console.log('fs1km missing');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'fs1km missing'
		});
		return;
	}
	
	if (!isValidNumber(conductivity)) {
		console.log('invalid conductivity value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid conductivity value'
		});
		return;
	}
	
	if (!isValidNumber(dielectric)) {
		console.log('invalid dielectric value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid dielectric value'
		});
		return;
	}
	
	if (!isValidNumber(freq)) {
		console.log('invalid freq value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid freq value'
		});
		return;
	}
	
	if (!isValidNumber(field)) {
		console.log('invalid distance value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid field value'
		});
		return;
	}
	
	if (!isValidNumber(fs1km)) {
		console.log('invalid fs1km value');
		res.status(400).send({
			'status': 'error',
			'statusCode':'400',
			'statusMessage': 'invalid fs1km value'
		});
		return;
	}
	
	conductivity = parseFloat(conductivity);
	dielectric = parseFloat(dielectric);
	freq = parseFloat(freq);
	field = parseFloat(field);
	fs1km = parseFloat(fs1km);
	

	var distance = amDistance(conductivity, dielectric, freq, field, fs1km);
	
	var response = {
		"input": {
			"conductivity": conductivity,
			"dielectric": dielectric,
			"freq": freq,
			"field": field,
			"fs1km": fs1km,
			"conductivity_unit": "milliSiemens/meter",
			"freq_unit": "MHz",
			"field_unit": "millivolt/meter",
			"fs1km_unit": "millivolt/meter"
		},
		"distance": distance,
		"unit": "km"
	};
	
	res.status(200).send(response);

}



var isValidNumber = function(a) {
	a = '' + a;
	if ( a.match(/^\d+\.+\d+$/)  || a.match(/^\.+\d+$/) || a.match(/^\d+\.$/) || a.match(/^\d+$/) ) {
		return true;
	}
	else {
		return false;
	}
}



//var field = amField(10, 15, 0.79, 100, 100);

//console.log('field', field);

module.exports.amField = amField;
module.exports.amFieldFromFormula = amFieldFromFormula;
module.exports.amDistance = amDistance;
module.exports.getAmField = getAmField;
module.exports.getAmDistance = getAmDistance;








