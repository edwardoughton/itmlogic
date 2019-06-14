function [ahd1]=ahd(td)

a=[   133.4    104.6     71.8];
b=[0.332e-3 0.212e-3 0.157e-3];
c=[  -4.343   -1.086    2.171];

if (td<=10e3)
  i=1;
elseif (td<=70e3)
  i=2;
else
  i=3;
end
ahd1=a(i)+b(i)*td+c(i)*log(td);