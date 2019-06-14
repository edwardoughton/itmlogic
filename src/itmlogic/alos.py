function [alos1]=alos(d,prop)
% Doesn't call anything

q=(1.-0.8*exp(-d/50e3))*prop.dh;

s=0.78*q*exp(-(q/16.)^0.25);

q=prop.he(1)+prop.he(2);
sps=q/sqrt(d^2+q^2);

r=(sps-prop.zgnd)/(sps+prop.zgnd)*exp(-min(10.,prop.wn*s*sps));

q=abs(r)^2;
if( (q<0.25) || (q<sps)) r=r*sqrt(sps/q); end

alos1=prop.emd*d+prop.aed;

q=prop.wn*prop.he(1)*prop.he(2)*2./d;

if (q>1.57) q=3.14-2.4649/q; end

alos1=(-4.343*log(abs(complex(cos(q),-sin(q))+r)^2)-alos1)*prop.wis+alos1;